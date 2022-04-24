import * as functions from "firebase-functions";
import { converter, db } from "../../_firebase";
import * as Firestore from "../../types/firestore";

interface UserAuthenticated {
  context: functions.https.CallableContext;
  index?: "matters" | "resources" | "companys" | "persons";
  type?: "likes" | "outputs" | "entries";
  canceled?: boolean;
}

export const userAuthenticated = async ({
  context,
  index,
  type,
  canceled,
}: UserAuthenticated): Promise<boolean> => {
  if (!context.auth)
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );

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

  if (index === "persons")
    if (payment.status === "canceled" || !payment.option?.freelanceDirect)
      throw new functions.https.HttpsError(
        "cancelled",
        "オプション未加入のアカウントのため、実行できません"
      );

  if (canceled)
    if (type !== "entries" && payment.status === "canceled") return false;

  return true;
};
