import express from 'express';
import { upload } from '../../../middleware/multer.js';
import { enrollFaceController } from '../controllers/enrollFaceController.js';
import { requireAuth } from '../../../auth/middleware.js';
import { verifyFaceController } from '../controllers/verify-face.controller.js';
const faceRouter=express.Router();

faceRouter.post('/enroll', requireAuth, upload.single("image"), enrollFaceController)
faceRouter.post('/verify', requireAuth, upload.single("image"), verifyFaceController)
export default faceRouter;
