import express from 'express';
import { Server } from 'socket.io';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
import configRouter from './config.js';
import https from 'https';

dotenv.config();

const PORT = process.env.PORT || 3000;
const ADMIN = "Admin";

const httpsAgent = new https.Agent({
    rejectUnauthorized: false, // temporary
});

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

    socket.on('enterRoom', async ({ user_id, chat_id }) => {
        try {
            console.log(`Validating user ${user_id} for chat ${chat_id}...`);
    
            // Validate user via PHP
            const response = await fetch(process.env.CHAT_VALIDATION_URL, { 
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                },
                body: JSON.stringify({ user_id, chat_id }),
                agent: httpsAgent // Keep using this for HTTPS compatibility
            });
    
            const rawText = await response.text();
    
            if (!response.ok) {
                console.error("Server Error:", rawText);
                socket.emit("errorMessage", "Server validation failed. Try again later.");
                return;
            }
    
            let data;
            try {
                data = JSON.parse(rawText);
            } catch (jsonError) {
                console.error("JSON Parsing Error:", jsonError, "\nRaw Response:", rawText);
                socket.emit("errorMessage", "Invalid response from server.");
                return;
            }
    
            if (!data.success) {
                console.warn(`Validation failed: ${data.message}`);
                socket.emit("errorMessage", "You are not a member of this chat.");
                return;
            }
    
            console.log(`User ${user_id} successfully validated for chat ${chat_id}`);
    
            const prevRoom = UsersState.get(socket.id)?.chat_id;
            if (prevRoom && prevRoom !== chat_id) {
                socket.leave(prevRoom);
                io.to(prevRoom).emit('join_leftChat', notifyMessage(user_id, `left chat ${prevRoom}.`));
            }
    
            UsersState.set(socket.id, { user_id, chat_id });
            socket.join(chat_id);
    
            io.to(chat_id).emit('join_leftChat', notifyMessage(user_id, `joined chat ${chat_id}.`));
    
            io.to(chat_id).emit('userList', {
                users: Array.from(UsersState.values())
                    .filter(u => u.chat_id === chat_id)
                    .map(u => u.user_id)
            });
    
        } catch (error) {
            console.error("Error entering room:", error);
            socket.emit("errorMessage", "Unexpected error occurred. Try again later.");
        }
    });

    socket.on("message", async ({ user_id, chat_id, text, file_url, file_type }) => {
        try {
            const user = UsersState.get(socket.id);
            if (!user || user.chat_id !== chat_id) return;

            const messageData = { user_id, chat_id, text, file_url, file_type };

            const dbResponse = await fetch(process.env.SAVE_MESSAGE_URL, {  
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(messageData),
                agent: httpsAgent
            });

            if (!dbResponse.ok) {
                console.error("Database error: Failed to store message");
                socket.emit("errorMessage", "Message could not be saved.");
                return;
            }

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
