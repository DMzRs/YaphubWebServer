import express from 'express';
import { Server } from 'socket.io';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
import configRouter from './config.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const ADMIN = "Admin";

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
        origin: process.env.CORS_ORIGINS.split(','), // Use environment variable
        methods: ["GET", "POST"], 
        credentials: true 
    }
});

io.on('connection', (socket) => {
    console.log(`User ${socket.id} connected`);

    socket.on('enterRoom', async ({ user_id, chat_id }) => {
        try {
            console.log(`Attempting to validate user ${user_id} for chat ${chat_id}`);

            // Validate user via PHP
            const response = await fetch(process.env.CHAT_VALIDATION_URL, { // Use environment variable
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id, chat_id })
            });

            const rawText = await response.text();

            let data;
            try {
                data = JSON.parse(rawText);
                console.log("Parsed JSON:", data);
            } catch (jsonError) {
                console.error("JSON Parsing Error:", jsonError);
                socket.emit("errorMessage", "Invalid server response. Please check the server logs.");
                return;
            }

            if (!data.success) {
                console.warn(`Validation failed: ${data.message}`);
                socket.emit("errorMessage", "You are not a member of this chat.");
                return;
            }

            console.log(`User ${user_id} successfully validated for chat ${chat_id}`);

            // Leave previous room if exists
            const prevRoom = UsersState.get(socket.id)?.chat_id;
            if (prevRoom) {
                socket.leave(prevRoom);
                io.to(prevRoom).emit('join_leftChat', notifyMessage(user_id, `left chat ${prevRoom}.`));
            }

            // Store user session in UsersState
            UsersState.set(socket.id, { user_id, chat_id });
            socket.join(chat_id);

            // Notify everyone in the chat that user joined
            io.to(chat_id).emit('join_leftChat', notifyMessage(user_id, `joined chat ${chat_id}.`));

            // Update user list for the chat
            io.to(chat_id).emit('userList', {
                users: Array.from(UsersState.values()).filter(u => u.chat_id === chat_id).map(u => u.user_id)
            });

        } catch (error) {
            console.error("Error entering room:", error);
            socket.emit("errorMessage", "Failed to join the chat.");
        }
    });

    // Listen for message
    socket.on("message", async ({ user_id, chat_id, text, file_url, file_type }) => {
        try {
            const user = UsersState.get(socket.id);
            if (!user || user.chat_id !== chat_id) return;

            // Construct message payload
            const messageData = { user_id, chat_id, text, file_url, file_type };

            // Store message in the database
            const dbResponse = await fetch(process.env.SAVE_MESSAGE_URL, { // Use environment variable
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(messageData),
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

            // Emit the message to the chat room
            io.to(chat_id).emit("message", messageData);

        } catch (error) {
            console.error("Error handling message:", error);
            socket.emit("errorMessage", "Failed to send the message.");
        }
    });

    // Starts typing
    socket.on("typing", ({ user_id, chat_id }) => {
        socket.to(chat_id).emit("typing", user_id);
    });

    // Stops typing
    socket.on("stopTyping", ({ user_id, chat_id }) => {
        socket.to(chat_id).emit("stopTyping", user_id);
    });

    // When user disconnects
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

// Function to build messages
function notifyMessage(user_id, text) {
    return {
        user_id,
        text,
        time: new Date().toLocaleTimeString()
    };
};