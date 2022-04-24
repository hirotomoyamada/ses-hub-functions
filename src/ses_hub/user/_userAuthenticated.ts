import * as functions from "firebase-functions";
import { converter, db } from "../../_firebase";
import * as Firestore from "../../types/firestore";

interface UserAuthenticated {
  context: functions.https.CallableContext;
  uid?: string;
  demo?: boolean;
  agree?: boolean;
  canceled?: boolean;
  parent?: boolean;
  child?: boolean;
  fetch?: boolean;
  option?: boolean;
  index?: string;
}
export const userAuthenticated = async ({
  context,
  uid,
  demo,
  agree,
  canceled,
  parent,
  child,
  fetch,
  index,
}: UserAuthenticated): Promise<boolean> => {
  if (context?.auth) {
    const doc = await db
      .collection("companys")
      .withConverter(converter<Firestore.Company>())
      .doc(!parent && !child ? context.auth.uid : (uid as string))
      .get();

    const data = doc.data();

    if (!data)
      throw new functions.https.HttpsError(
        "cancelled",
        "無効なアカウントのため、実行できません"
      );

    const { status, agree, type, payment } = data;
    const { ses_hub } = functions.config().demo;

    if (status !== "enable")
      throw new functions.https.HttpsError(
        "cancelled",
        "無効なアカウントのため、実行できません"
      );

    if (agree !== "enable" && !agree)
      throw new functions.https.HttpsError(
        "cancelled",
        "利用規約の同意が無いアカウントため、実行できません"
      );

    if (demo)
      if ((!parent ? context.auth.uid : uid) === ses_hub.uid)
        throw new functions.https.HttpsError(
          "cancelled",
          "デモのアカウントのため、実行できません"
        );

    if (child)
      if (context.auth.uid !== uid)
        if (payment.parent !== context.auth.uid)
          throw new functions.https.HttpsError(
            "cancelled",
            "無効なアカウントのため、実行できません"
          );

    if (parent)
      if (type !== "parent")
        throw new functions.https.HttpsError(
          "cancelled",
          "無効なアカウントのため、実行できません"
        );

    if (index === "persons")
      if (payment.status === "canceled" || !payment.option?.freelanceDirect)
        throw new functions.https.HttpsError(
          "cancelled",
          "オプション未加入のアカウントのため、実行できません"
        );

    if (canceled)
      if (payment.status === "canceled")
        if (!fetch) {
          throw new functions.https.HttpsError(
            "cancelled",
            "無料のアカウントのため、実行できません"
          );
        } else {
          return false;
        }

    return true;
  } else {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません"
    );
  }
};
