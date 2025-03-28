import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import configRouter from './config.js';


dotenv.config();

const PORT = process.env.PORT || 3000;

const UsersState = new Map(); // Stores { socketId -> { user_id, chat_id } }

const app = express();
app.use(express.json());

// Enable CORS
app.use(cors({
    origin: process.env.CORS_ORIGINS.split(','), // Use environment variable
    methods: ["GET", "POST"],
    credentials: true
}));

app.use('/api', configRouter); // Use config router

const expressServer = app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});

const io = new Server(expressServer, {
    cors: {
        origin: process.env.CORS_ORIGINS.split(','),
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    },
    transports: ["websocket", "polling"] // Ensure WebSockets work properly
});

io.on('connection', (socket) => {
    console.log(`User ${socket.id} connected`);

    socket.on("enterRoom", async ({ user_id, chat_id }) => {
        try {
            console.log(`User ${user_id} joined chat ${chat_id}`);
    
            // Leave previous room if exists
            const prevRoom = UsersState.get(socket.id)?.chat_id;
            if (prevRoom && prevRoom !== chat_id) {
                socket.leave(prevRoom);
                io.to(prevRoom).emit("join_leftChat", notifyMessage(user_id, `left chat ${prevRoom}.`));
            }
    
            // Store user session in UsersState
            UsersState.set(socket.id, { user_id, chat_id });
            socket.join(chat_id);
    
            // Notify everyone in the chat that user joined
            io.to(chat_id).emit("join_leftChat", notifyMessage(user_id, `joined chat ${chat_id}.`));
    
            // Update user list for the chat
            io.to(chat_id).emit("userList", {
                users: Array.from(UsersState.values()).filter((u) => u.chat_id === chat_id).map((u) => u.user_id),
            });
    
    
        } catch (error) {
            console.error("Error entering room:", error);
            socket.emit("errorMessage", "Unexpected error occurred. Try again later.");
        }
    });

    // Listen for message
    socket.on("message", async ({ user_id, chat_id, text, file_url, file_type }) => {
        try {
            const user = UsersState.get(socket.id);
            if (!user || user.chat_id !== chat_id) return;

            const messageData = { user_id, chat_id, text, file_url, file_type };

            if (file_url) {
                console.log(`File message from user ${user_id} in chat ${chat_id}: ${file_url}`);
            } else {
                console.log(`Text message from user ${user_id} in chat ${chat_id}: ${text}`);
            }

            io.to(chat_id).emit("message", messageData);

        } catch (error) {
            console.error("Error handling message:", error);
            socket.emit("errorMessage", "Failed to send the message.");
        }
    });



    socket.on("typing", ({ user_id, chat_id }) => {
        socket.to(chat_id).emit("typing", user_id);
    });

    socket.on("stopTyping", ({ user_id, chat_id }) => {
        socket.to(chat_id).emit("stopTyping", user_id);
    });

    socket.on('disconnect', () => {
        const user = UsersState.get(socket.id);
        if (user) {
            UsersState.delete(socket.id);
            io.to(user.chat_id).emit('join_leftChat', notifyMessage(user.user_id, `left the chat.`));
            io.to(user.chat_id).emit('userList', {
                users: Array.from(UsersState.values()).filter(u => u.chat_id === user.chat_id).map(u => u.user_id)
            });
        }

        console.log(`User ${socket.id} disconnected`);
    });
});

function notifyMessage(user_id, text) {
    return {
        user_id,
        text,
        time: new Date().toLocaleTimeString()
    };
};
