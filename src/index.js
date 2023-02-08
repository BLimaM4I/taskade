const { ApolloServer, gql } = require("apollo-server");
const { MongoClient, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
dotenv.config();

const { DB_URI, DB_NAME, JWT_SECRET } = process.env;

const getToken = (user) =>
  jwt.sign({ id: user._id }, JWT_SECRET, {
    expiresIn: "30 days",
  });

const getUserFromToken = async (token, db) => {
  if (!token) {
    return null;
  }

  const tokenData = jwt.verify(token, JWT_SECRET);
  if (!tokenData?.id) {
    return null;
  }
  return await db
    .collection("Users")
    .findOne({ _id: new ObjectId(tokenData.id) });
};

const typeDefs = gql`
  type Query {
    myTaskLists: [TaskList!]!
    getTaskList(id: ID!): TaskList
  }

  input SignUpInput {
    email: String!
    password: String!
    name: String!
    avatar: String
  }

  input SignInInput {
    email: String!
    password: String!
  }

  type Mutation {
    signUp(input: SignUpInput!): AuthUser!
    signIn(input: SignInInput!): AuthUser!

    createTaskList(title: String!): TaskList!
    updateTaskList(id: ID!, title: String!): TaskList!
    deleteTaskList(id: ID!): Boolean!
    addUserToTaskList(taskListId: ID!, userId: ID!): TaskList
  }

  type AuthUser {
    user: User!
    token: String!
  }

  type User {
    id: ID!
    name: String!
    email: String!
    avatar: String
  }

  type TaskList {
    id: ID!
    createdAt: String!
    title: String!
    progress: Float!
    users: [User!]!
    todos: [ToDo!]!
  }

  type ToDo {
    id: ID!
    content: String!
    isCompleted: Boolean!
    taskList: TaskList!
  }
`;

const resolvers = {
  Query: {
    myTaskLists: async (_, __, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      return await db
        .collection("TaskList")
        .find({ userIds: user._id })
        .toArray();
    },
    getTaskList: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      return await db.collection("TaskList").findOne({ _id: new ObjectId(id) });
    },
  },
  Mutation: {
    signUp: async (_, { input }, { db }) => {
      const hashedPassword = bcrypt.hashSync(input.password);
      const newUser = {
        ...input,
        password: hashedPassword,
      };
      //save to database
      const result = await db.collection("Users").insertOne(newUser);
      const user = result.ops[0];
      return {
        user,
        token: getToken(user),
      };
    },
    signIn: async (_, { input }, { db }) => {
      const user = await db.collection("Users").findOne({
        email: input.email,
      });
      const isPasswordCorrect =
        user && bcrypt.compare(input.password, user.password);
      if (!user || !isPasswordCorrect) {
        throw new Error("Invalid credentials");
      }
      return {
        user,
        token: getToken(user),
      };
    },
    createTaskList: async (_, { title }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      const newTaskList = {
        title,
        createdAt: new Date().toISOString(),
        userIds: [user._id],
      };
      const result = await db.collection("TaskList").insertOne(newTaskList);
      return newTaskList;
    },
    updateTaskList: async (_, { id, title }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      const result = await db.collection("TaskList").updateOne(
        {
          _id: new ObjectId(id),
        },
        {
          $set: {
            title,
          },
        }
      );
      return await db.collection("TaskList").findOne({
        _id: new ObjectId(id),
      });
    },
    addUserToTaskList: async (_, { taskListId, userId }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }

      const taskList = await db.collection("TaskList").findOne({
        _id: new ObjectId(taskListId),
      });

      if (!taskList) {
        return null;
      }

      if (
        taskList.userIds.find((dbId) => dbId.toString() === userId.toString())
      ) {
        return taskList;
      }

      await db.collection("TaskList").updateOne(
        {
          _id: new ObjectId(taskListId),
        },
        {
          $push: {
            userIds: new ObjectId(userId),
          },
        }
      );
      taskList.userIds.push(new ObjectId(userId));
      return taskList;
    },
    deleteTaskList: async (_, { id }, { db, user }) => {
      if (!user) {
        throw new Error("Authentication Error. Please sign in");
      }
      //TODO only collaborators of this task list should be able to delete
      await db.collection("TaskList").deleteOne({ _id: new ObjectId(id) });
      return true;
    },
  },
  User: {
    id: ({ _id, id }) => _id || id,
  },
  TaskList: {
    id: ({ _id, id }) => _id || id,
    progress: () => 0,
    users: async ({ userIds }, _, { db }) => {
      return Promise.all(
        userIds.map((userId) => db.collection("Users").findOne({ _id: userId }))
      );
    },
  },
};

const start = async () => {
  const client = new MongoClient(DB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  const db = client.db(DB_NAME);

  // The ApolloServer constructor requires two parameters: your schema
  // definition and your set of resolvers.
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    context: async ({ req }) => {
      const user = await getUserFromToken(req.headers.authorization, db);
      return {
        db,
        user,
      };
    },
  });

  // The `listen` method launches a web server.
  server.listen().then(({ url }) => {
    console.log(`🚀  Server ready at ${url}`);
  });
};

start();
