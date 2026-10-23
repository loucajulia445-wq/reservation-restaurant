import { sendGmailEmail } from "./gmail-mailer.js";

const destinataire = "lezinc.83toulon@gmail.com";

try {
await sendGmailEmail({
to: destinataire,
subject: "Test Gmail - Le Zinc",
html: `       <h2>Test d'envoi Gmail réussi !</h2>       <p>Ce message vérifie que l'envoi Gmail fonctionne.</p>       <p>Les e-mails de réservation ne sont pas encore basculés depuis Resend.</p>
    `,
});

console.log("✅ E-mail de test envoyé à", destinataire);
} catch (error) {
console.error("❌ Échec de l'envoi Gmail :", error.message);
process.exitCode = 1;
}
