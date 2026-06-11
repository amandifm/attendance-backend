import { prisma } from "./db.js";
import { config } from "./config.js";

type EmailInput = {
  toEmail: string;
  subject: string;
  body: string;
  relatedType?: string;
  relatedId?: string;
};

export async function queueEmail(input: EmailInput) {
  const delivery = await prisma.emailDelivery.create({
    data: {
      toEmail: input.toEmail,
      subject: input.subject,
      body: input.body,
      provider: config.emailProvider,
      relatedType: input.relatedType,
      relatedId: input.relatedId
    }
  });

  if (config.emailProvider === "log") {
    return prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "SKIPPED", error: "EMAIL_PROVIDER=log", sentAt: new Date() }
    });
  }

  if (config.emailProvider !== "sendgrid" || !config.sendgridApiKey) {
    return prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", error: "Email provider is not configured." }
    });
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.sendgridApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.toEmail }] }],
        from: { email: config.emailFrom },
        subject: input.subject,
        content: [{ type: "text/plain", value: input.body }]
      })
    });

    if (!response.ok) {
      throw new Error(`SendGrid returned ${response.status}`);
    }

    return prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "SENT", sentAt: new Date() }
    });
  } catch (error) {
    return prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : "Email send failed." }
    });
  }
}
