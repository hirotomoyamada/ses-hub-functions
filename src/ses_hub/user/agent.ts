import * as functions from "firebase-functions";
import { location, runtime } from "../../_firebase";

export const getUserAgent = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (_data: unknown, context) => {
    const userAgent = context.rawRequest.headers["user-agent"];
    const ip = context.rawRequest.headers["x-appengine-user-ip"];

    return { ip, userAgent };
  });
