import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import { config } from "./config.js";

let io: Server;

export function initSocket(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: "*", // Or specify allowed origins
      methods: ["GET", "POST"]
    }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(" ")[1];
    if (!token) {
      return next(new Error("Authentication error"));
    }
    try {
      const decoded = jwt.verify(token, config.jwtAccessSecret) as any;
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket: Socket) => {
    console.log(`Socket connected: ${socket.id} (User: ${socket.data.user?.userId})`);
    
    // Users join a room with their user ID so we can emit private messages to them
    if (socket.data.user?.userId) {
      socket.join(`user_${socket.data.user.userId}`);
    }

    // Admins and HR join a global 'management' room to receive live updates
    if (socket.data.user?.role === "ADMIN" || socket.data.user?.role === "HR") {
      socket.join("management");
    }

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO() {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
}

// Function to emit a specific event to a user
export function emitToUser(userId: string, event: string, data: any) {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
}

// Function to emit an event to all managers (admin/hr)
export function emitToManagement(event: string, data: any) {
  if (io) {
    io.to("management").emit(event, data);
  }
}

// Function to broadcast a global event to everyone
export function broadcastEvent(event: string, data: any) {
  if (io) {
    io.emit(event, data);
  }
}
