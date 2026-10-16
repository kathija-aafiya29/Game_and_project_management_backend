import { getS3 } from "../config/s3.js";

import dotenv from "dotenv";

dotenv.config();

const BUCKET =
  process.env.S3_BUCKET_NAME;

// Upload File
export const uploadToS3 =
  async (key, data) => {

    try {

      const s3 =
        getS3();

      const params = {

        Bucket:
          BUCKET,

        Key:
          key,

        Body:
          data,
      };

      return await s3
        .upload(params)
        .promise();

    } catch (error) {

      console.error(
        "S3 Upload Error:",
        error
      );

      throw error;
    }
  };

// List Objects Inside Folder
export const listFolder =
  async (folderName) => {

    try {

      const s3 =
        getS3();

      const params = {

        Bucket:
          BUCKET,

        Prefix:
          `${folderName}/`,
      };

      return await s3
        .listObjectsV2(params)
        .promise();

    } catch (error) {

      console.error(
        "S3 List Folder Error:",
        error
      );

      throw error;
    }
  };

// Calculate Folder Size
export const getFolderSize =
  async (folderName) => {

    try {

      const files =
        await listFolder(folderName);

      let totalSize = 0;

      files.Contents.forEach(
        (file) => {

          totalSize +=
            file.Size;
        }
      );

      return (
        totalSize /
        (1024 * 1024)
      ).toFixed(2);

    } catch (error) {

      console.error(
        "S3 Folder Size Error:",
        error
      );

      throw error;
    }
  };