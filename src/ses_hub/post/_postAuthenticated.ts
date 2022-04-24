import * as functions from "firebase-functions";
import { converter, db } from "../../_firebase";
import * as Firestore from "../../types/firestore";

interface PostAuthenticated {
  context: functions.https.CallableContext;
  canceled?: boolean;
}

export const postAuthenticated = async ({
  context,
  canceled,
}: PostAuthenticated): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(context.auth.uid)
    .get();

  const data = doc.data();

  if (!data)
    throw new functions.https.HttpsError(
      "cancelled",
      "無効なアカウントのため、実行できません"
    );

  const { status, agree, payment } = data;
  const { ses_hub } = functions.config().demo;

  if (context.auth.uid === ses_hub.uid) {
    throw new functions.https.HttpsError(
      "cancelled",
      "デモのアカウントのため、実行できません"
    );
  }

  if (status !== "enable")
    throw new functions.https.HttpsError(
      "cancelled",
      "無効なアカウントのため、実行できません"
    );

  if (agree !== "enable")
    throw new functions.https.HttpsError(
      "cancelled",
      "利用規約の同意が無いアカウントため、実行できません"
    );

  if (canceled)
    if (payment.status === "canceled")
      throw new functions.https.HttpsError(
        "cancelled",
        "無料のアカウントのため、実行できません"
      );
};
