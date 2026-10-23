import { google } from "googleapis";
import open from "open";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const credentialsPath = path.join(
projectRoot,
"client_secret_2522739428-ebot5qkeiddlcdh74mhlr9eha7rbqkuj.apps.googleusercontent.com.json"
);

if (!fs.existsSync(credentialsPath)) {
  console.error("Fichier d'identifiants Google introuvable :");
  console.error(credentialsPath);
  process.exit(1);
}

const credentials = JSON.parse(
  fs.readFileSync(credentialsPath, "utf8")
);

const oauthCredentials = credentials.installed ?? credentials.web;

if (!oauthCredentials) {
  console.error(
    "Le fichier JSON ne contient ni configuration 'installed' ni 'web'."
  );
  process.exit(1);
}

const redirectUri = "http://localhost:3001/oauth2callback";

const oauth2Client = new google.auth.OAuth2(
  oauthCredentials.client_id,
  oauthCredentials.client_secret,
  redirectUri
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/gmail.send"],
  prompt: "consent",
});

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, redirectUri);

    if (requestUrl.pathname !== "/oauth2callback") {
      res.writeHead(404);
      res.end("Page introuvable.");
      return;
    }

    const error = requestUrl.searchParams.get("error");
    const code = requestUrl.searchParams.get("code");

    if (error) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Autorisation refusée. Tu peux fermer cette fenêtre.");
      console.error("Google a refusé l'autorisation :", error);
      server.close();
      return;
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Code d'autorisation manquant.");
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    const tokenPath = path.join(projectRoot, "token.json");

    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), {
      mode: 0o600,
    });

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "Autorisation Google réussie ! Tu peux fermer cette fenêtre et revenir au terminal."
    );

    console.log("\n✅ Autorisation Google réussie !");
    console.log("Le fichier token.json a été créé à la racine du projet.");
    console.log("Garde ce fichier confidentiel et ne le partage jamais.");

    server.close();
  } catch (error) {
    console.error("Erreur pendant l'autorisation Google :", error.message);

    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }

    res.end("Une erreur est survenue. Consulte le terminal.");
    server.close();
  }
});

server.on("error", (error) => {
  console.error("Impossible de démarrer le serveur local :", error.message);
  process.exitCode = 1;
});

server.listen(3001, "127.0.0.1", async () => {
  console.log("Ouverture de la page d'autorisation Google...");
  console.log("Si le navigateur ne s'ouvre pas, utilise ce lien :");
  console.log(authUrl);

  try {
    await open(authUrl);
  } catch {
    console.log("Ouvre manuellement le lien affiché ci-dessus.");
  }
});
