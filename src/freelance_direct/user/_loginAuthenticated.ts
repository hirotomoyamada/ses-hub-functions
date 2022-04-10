import * as functions from "firebase-functions";
import { converter, db } from "../../_firebase";
import { Data } from "./login";
import { Company } from "../../types/firestore";

interface LoginAuthenticated {
  data?: Data;
  context?: functions.https.CallableContext;
  doc?: FirebaseFirestore.DocumentSnapshot<Company>;
}

export const loginAuthenticated = async ({
  data,
  context,
  doc,
}: LoginAuthenticated) => {
  if (!doc) {
    if (!context?.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "認証されていないユーザーではログインできません"
      );
    }

    const doc = await db
      .collection("companys")
      .withConverter(converter<Company>())
      .doc(context.auth.uid)
      .get();

    if (doc.exists) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "このアカウントでは利用できません"
      );
    }

    if (!data?.emailVerified) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "メールアドレスが認証されていません"
      );
    }
  } else {
    if (doc.data()?.status === "hold") {
      throw new functions.https.HttpsError(
        "permission-denied",
        "承認されていません"
      );
    }

    if (doc.data()?.status === "disable") {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "プロバイダーの更新に失敗しました"
      );
    }
  }
};
