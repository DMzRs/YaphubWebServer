import express from 'express';
import { Server } from 'socket.io';
import puppeteer from 'puppeteer';
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
    origin: process.env.CORS_ORIGINS.split(','),
    methods: ["GET", "POST"],
    credentials: true
}));

app.use('/api', configRouter);

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
    transports: ["websocket", "polling"]
});

async function validateUser(user_id, chat_id) {
    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    
    try {
        await page.goto(process.env.CHAT_VALIDATION_URL, { waitUntil: "networkidle2" });
        
        const response = await page.evaluate(async (user_id, chat_id) => {
            const res = await fetch(process.env.CHAT_VALIDATION_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id, chat_id })
            });
            return await res.json();
        }, user_id, chat_id);
        
        await browser.close();
        return response;
    } catch (error) {
        console.error("Puppeteer error:", error);
        await browser.close();
        return { success: false, message: "Validation failed." };
    }
}

io.on('connection', (socket) => {
    console.log(`User ${socket.id} connected`);

    socket.on('enterRoom', async ({ user_id, chat_id }) => {
        try {
            const data = await validateUser(user_id, chat_id);
            if (!data.success) {
                socket.emit("errorMessage", "You are not a member of this chat.");
                return;
            }

            console.log(`User ${user_id} validated for chat ${chat_id}`);

            const prevRoom = UsersState.get(socket.id)?.chat_id;
            if (prevRoom && prevRoom !== chat_id) {
                socket.leave(prevRoom);
                io.to(prevRoom).emit('join_leftChat', notifyMessage(user_id, `left chat ${prevRoom}.`));
            }

            UsersState.set(socket.id, { user_id, chat_id });
            socket.join(chat_id);

            io.to(chat_id).emit('join_leftChat', notifyMessage(user_id, `joined chat ${chat_id}.`));
            io.to(chat_id).emit('userList', {
                users: Array.from(UsersState.values()).filter(u => u.chat_id === chat_id).map(u => u.user_id)
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
                body: JSON.stringify(messageData)
            });

            if (!dbResponse.ok) {
                console.error("Database error: Failed to store message");
                socket.emit("errorMessage", "Message could not be saved.");
                return;
            }

            io.to(chat_id).emit("message", messageData);
            console.log(`Message sent: ${text || file_url}`);

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
}
