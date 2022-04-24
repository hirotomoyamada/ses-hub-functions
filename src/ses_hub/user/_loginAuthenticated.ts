import * as functions from "firebase-functions";
import { converter, db } from "../../_firebase";
import { Data } from "./login";
import { Company, Person } from "../../types/firestore";

interface LoginAuthenticated {
  data?: Data;
  context?: functions.https.CallableContext;
  doc?: FirebaseFirestore.DocumentSnapshot<Company>;
}

export const loginAuthenticated = async ({
  data,
  context,
  doc,
}: LoginAuthenticated): Promise<void> => {
  if (!doc) {
    if (!context?.auth)
      throw new functions.https.HttpsError(
        "unauthenticated",
        "認証されていないユーザーではログインできません"
      );

    const doc = await db
      .collection("persons")
      .withConverter(converter<Person>())
      .doc(context.auth.uid)
      .get();

    if (doc.exists)
      throw new functions.https.HttpsError(
        "unauthenticated",
        "このアカウントでは利用できません"
      );

    if (!data?.emailVerified)
      throw new functions.https.HttpsError(
        "invalid-argument",
        "メールアドレスが認証されていません"
      );
  } else {
    const data = doc.data();

    if (!data)
      throw new functions.https.HttpsError(
        "cancelled",
        "無効なアカウントのため、実行できません"
      );

    const { status } = data;

    if (status === "hold")
      throw new functions.https.HttpsError(
        "permission-denied",
        "承認されていません"
      );

    if (status === "disable")
      throw new functions.https.HttpsError(
        "unauthenticated",
        "プロバイダーの更新に失敗しました"
      );
  }
};
