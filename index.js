const http = require("http");
const Websocket = require("ws");

const server = http.createServer();
const ws = new Websocket.Server({ server });

//  Utils
const generateRandomString = (length = 8, factory = "abcdefghijklmnopqrst") => {
  let string = "";

  for (let i = length; i > 0; i -= 1) {
    const char = factory.charAt(Math.floor(Math.random() * factory.length));
    string +=
      Math.random() > Math.random() ? char.toUpperCase() : char.toLowerCase();
  }

  return string;
};

// Errors
function BadError(message = "bad error") {
  this.message = message;
  this.action = "BadError";
}
function AuthenticationError(message = "invalid credentials") {
  this.message = message;
  this.action = "AuthenticationError";
}
function AuthorizationError(message = "unauthorized") {
  this.message = message;
  this.action = "AuthorizationError";
}

// Database
function DB() {
  function Model() {
    const entries = [];

    this.create = (entry) => {
      entry.id = generateRandomString();
      entries.push(entry);

      return entry;
    };

    this.findOne = (params) => {
      const requestedEntry = entries.find((entry) => {
        return Object.keys(params).every((key) => {
          return params[key] === entry[key];
        });
      });

      if (!requestedEntry) return null;

      return requestedEntry;
    };

    this.find = (params) => {
      return entries.filter((entry) => {
        return Object.keys(params).every((key) => {
          return params[key] === entry[key];
        });
      });
    };

    this.customQuery = (cb = () => {}) => {
      const entriesCopy = [...entries];
      return cb(entriesCopy);
    };
  }

  this.registerModel = () => {
    return new Model();
  };
}

// Services
function HandlerService() {
  const actionHandlers = {};

  this.getHandler = function (key) {
    return actionHandlers[key];
  };

  this.registerHandler = function (key, ...handlers) {
    actionHandlers[key] = handlers;
  };

  this.callHandler = (key, arg) => {
    const handlers = actionHandlers[key];
    let lastValue;
    if (handlers) {
      handlers.forEach((handler) => {
        lastValue = handler(arg);
      });
    }
    return lastValue;
  };
}

function WSService(handlerService) {
  // Private ppties
  const sockets = {};

  // Private methods
  const removeSocket = (socket) => {
    console.log("[SOCKET DISCONNECT]", socket.id);
    delete sockets[socket.id];
  };

  const parseMessage = (socket, message) => {
    const { action, data } = JSON.parse(message);

    try {
      const resp = handlerService.callHandler(action, { data, socket });
      if (resp) {
        socket.send(JSON.stringify(resp));
      }
    } catch (error) {
      const { action, message: data } = error;
      socket.send(JSON.stringify({ action, data }));
    }
  };

  this.registerSocket = (socket) => {
    const socketID = generateRandomString();

    socket.id = socketID;
    sockets[socketID] = socket;

    socket.on("close", () => removeSocket(socket));
    socket.on("message", (message) => parseMessage(socket, message));

    console.log("[NEW SOCKET] - ", socketID);
  };
}

function AuthenticationService(userModel) {
  this.login = ({ data, socket }) => {
    const user = userModel.findOne({
      username: data.username,
      password: data.password,
    });

    if (!user) {
      throw new AuthenticationError("invalid credentials");
    }
    socket.id = user.id;

    return {
      action: "LoggedIn",
      data: user,
    };
  };

  this.signup = ({ data, socket }) => {
    let user = userModel.findOne({ username: data.username });

    if (user) {
      throw new BadError("username already taken");
    }

    user = userModel.create(data);
    socket.id = user.id;
    return {
      action: "AccountCreated",
      data: user,
    };
  };

  this.authorize = ({ socket }) => {
    const { id } = socket;
    const userExists = userModel.findOne({ id });
    if (!userExists) {
      throw new AuthorizationError();
    }
  };
}

function MessageService(messageModel, userModel) {
  this.listPeople = ({ socket }) => {
    const ommit = messageModel.customQuery((messages) => {
      return messages
        .filter((message) => {
          return message.sender === socket.id || message.reciever === socket.id;
        })
        .reduce(
          (acc, message) => {
            if (message.sender === socket.id) {
              acc.push(message.reciever);
            } else {
              acc.push(message.sender);
            }
            return acc;
          },
          [socket.id]
        );
    });

    const people = userModel.customQuery((users) => {
      return users
        .filter((user) => {
          return !ommit.includes(user.id);
        })
        .map((user) => ({ username: user.username, id: user.id }));
    });

    return {
      action: "PeopleList",
      data: people,
    };
  };
}

//  main
const db = new DB();
const userModel = db.registerModel();
const messageModel = db.registerModel();
const handlerService = new HandlerService();
const wsService = new WSService(handlerService);
const authService = new AuthenticationService(userModel);
const messageService = new MessageService(messageModel, userModel);

ws.on("connection", (socket) => {
  wsService.registerSocket(socket);
});

//  handler registration
handlerService.registerHandler("login", authService.login);
handlerService.registerHandler("signup", authService.signup);
handlerService.registerHandler(
  "people",
  authService.authorize,
  messageService.listPeople
);

// Server inits
const port = 8080;
server.listen(port, () => {
  console.log(`server listening on port ${port} - http://localhost:${port}`);
});
