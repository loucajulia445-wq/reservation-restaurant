import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGmailRawMessage } from "./email-format.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const tokenPath = path.join(projectRoot, "token.json");

const credentialsPath = path.join(
projectRoot,
"client_secret_2522739428-ebot5qkeiddlcdh74mhlr9eha7rbqkuj.apps.googleusercontent.com.json"
);

if (!fs.existsSync(tokenPath)) {
throw new Error("Fichier token.json introuvable.");
}

if (!fs.existsSync(credentialsPath)) {
throw new Error("Fichier d'identifiants Google introuvable.");
}

const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
const oauthCredentials = credentials.installed ?? credentials.web;

if (!oauthCredentials) {
throw new Error("Configuration OAuth Google invalide.");
}

const oauth2Client = new google.auth.OAuth2(
oauthCredentials.client_id,
oauthCredentials.client_secret,
"http://localhost:3001/oauth2callback"
);

oauth2Client.setCredentials(token);

const gmail = google.gmail({
version: "v1",
auth: oauth2Client,
});

export async function sendGmailEmail({ to, subject, html }) {
const sender = process.env.GMAIL_SENDER_EMAIL || "lezinc.83toulon@gmail.com";
const raw = buildGmailRawMessage({ sender, to, subject, html });

const response = await gmail.users.messages.send({
userId: "me",
requestBody: { raw },
});

console.log("E-mail Gmail envoyé. Identifiant :", response.data.id);
return response.data;
}
