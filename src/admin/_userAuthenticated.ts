import * as functions from "firebase-functions";

export const userAuthenticated = async (
  context: functions.https.CallableContext
): Promise<string> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  if (context.auth?.uid !== functions.config().admin.uid) {
    throw new functions.https.HttpsError(
      "cancelled",
      "無効なユーザーのため、処理中止",
      "firebase"
    );
  }

  const uid = context.auth.uid;

  return uid;
};
