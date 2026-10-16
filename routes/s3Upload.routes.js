import express from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Config } from "../config/config.js";

const router = express.Router();

router.post("/get-upload-url", async (req, res) => {
  try {
    const { fileName, fileType, fileBase64 } = req.body;

    if (!fileName || !fileBase64) {
      return res.status(400).json({ message: "Missing file data" });
    }

    // ✅ SAFE: config loaded only when request comes
    const config = getS3Config();

    const s3 = new S3Client({
      region: config.AWS_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
    });

    const buffer = Buffer.from(fileBase64, "base64");

    const key = `bug_management/${Date.now()}-${fileName}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: fileType,
        ContentDisposition: "inline",
        ACL: "public-read",
      })
    );

    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodeURIComponent(key)}`;

    return res.json({
      name: fileName,
      url: fileUrl,
      type: fileType,
    });

  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Upload failed" });
  }
});

export default router;