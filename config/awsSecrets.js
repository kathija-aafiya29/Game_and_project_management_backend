import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({
  region: "ap-south-1",
});

export const getSecret = async (secretName) => {

  try {

    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretName,
      })
    );

    if (!response.SecretString) {

      throw new Error(
        `Secret ${secretName} is empty`
      );
    }

    return JSON.parse(
      response.SecretString
    );

  } catch (error) {

    console.error(
      `Error fetching secret ${secretName}:`,
      error
    );

    throw error;
  }
};