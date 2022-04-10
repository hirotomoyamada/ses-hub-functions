import * as functions from "firebase-functions";
import { location, runtime } from "../../_firebase";
import { send } from "../../_sendgrid";
import * as body from "./_promotion";

export type Data = {
  company: string;
  person: string;
  position: string;
  email: string;
  body: string;
};

export const contactPromotion = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data) => {
    const url = functions.config().app.freelance_direct.url;

    const adminMail = {
      to: functions.config().admin.freelance_direct as string,
      from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
      subject: `【お問い合わせ】${data.company} ${data.person}様より`,
      text: body.admin(data),
    };

    const userMail = {
      to: data.email,
      from: `Freelance Direct <${functions.config().admin.freelance_direct}>`,
      subject: "Freelance Direct お問い合わせありがとうございます",
      text: body.user(data, url),
    };

    await send(adminMail);
    await send(userMail);
  });
