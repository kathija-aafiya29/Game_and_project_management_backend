import AWS from "aws-sdk";

import {
  getS3Config
} from "./config.js";

export const getS3 = () => {

  const s3Config =
    getS3Config();

  AWS.config.update({

    accessKeyId:
      s3Config.AWS_ACCESS_KEY_ID,

    secretAccessKey:
      s3Config.AWS_SECRET_ACCESS_KEY,

    region:
      s3Config.AWS_REGION,
  });

  return new AWS.S3();
};