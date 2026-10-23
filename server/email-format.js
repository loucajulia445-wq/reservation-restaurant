function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function encodeMimeBody(value) {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return encoded.match(/.{1,76}/g)?.join('\r\n') || '';
}

export function buildGmailRawMessage({ sender, to, subject, html }) {
  if (!sender || !to || !subject || !html) {
    throw new Error('L’expéditeur, le destinataire, le sujet et le message sont obligatoires.');
  }
  if (/[\r\n]/.test(sender) || /[\r\n]/.test(to) || /[\r\n]/.test(subject)) {
    throw new Error('Les en-têtes e-mail ne doivent pas contenir de retours à la ligne.');
  }

  const message = [
    `From: Le Zinc Bouillon <${sender}>`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(html),
  ].join('\r\n');

  return Buffer.from(message, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
