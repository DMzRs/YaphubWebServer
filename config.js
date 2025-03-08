import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

router.get('/config', (req, res) => {
    res.json({
        CHAT_VALIDATION_URL: process.env.CHAT_VALIDATION_URL,
        SAVE_MESSAGE_URL: process.env.SAVE_MESSAGE_URL,
        REMOVE_USER_URL: process.env.REMOVE_USER_URL,
        GET_CHAT_INFO_URL: process.env.GET_CHAT_INFO_URL,
        GET_MESSAGES_URL: process.env.GET_MESSAGES_URL,
        UPLOAD_FILE_MESSAGE_URL: process.env.UPLOAD_FILE_MESSAGE_URL,
        GET_USER_PROFILE_URL: process.env.GET_USER_PROFILE_URL,
        ADD_USER_TO_GROUP_URL: process.env.ADD_USER_TO_GROUP_URL,
        GET_USERS_URL: process.env.GET_USERS_URL,
        GET_GROUP_MEMBERS_URL: process.env.GET_GROUP_MEMBERS_URL,
        DISCOVER_PEOPLE_URL: process.env.DISCOVER_PEOPLE_URL,
        ADD_FRIEND_URL: process.env.ADD_FRIEND_URL,
        HANDLE_FRIEND_REQUEST_URL: process.env.HANDLE_FRIEND_REQUEST_URL,
        SHOW_USERS_CREATE_GROUP_URL: process.env.SHOW_USERS_CREATE_GROUP_URL,
        CREATE_GROUP_URL: process.env.CREATE_GROUP_URL,
        EDIT_PROFILE_URL: process.env.EDIT_PROFILE_URL,
        INBOX_URL: process.env.INBOX_URL,
        INBOX_GROUP_URL: process.env.INBOX_GROUP_URL
    });
});

export default router;