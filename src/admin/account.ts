import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../_firebase";
import { algolia } from "../_algolia";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../types/firestore";
import * as Algolia from "../types/algolia";
import { NestedPartial } from "../types/utils";

type Data = {
  uid: string;
  status: "active" | "trialing" | "canceled";
  account?: number;
  freelanceDirect?: string;
  analytics?: string;
}[];

export const updateAccount = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated(context);

    await Promise.allSettled(
      data.map(async (user) => {
        const children = await updateFirestore(user);
        await updateAlgolia(user);

        if (!children?.length) return;

        await Promise.allSettled(
          children.map(async (child) => {
            await updateFirestore(user, child);
            await updateAlgolia(user, child);
          })
        );
      })
    );

    return data;
  });

const updateFirestore = async (
  user: Data[number],
  child?: string
): Promise<string[] | undefined> => {
  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(!child ? user?.uid : child)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
    });

  const parent = doc.data()?.type === "parent";
  const payment = doc.data()?.payment;

  if (!payment) {
    throw new functions.https.HttpsError(
      "not-found",
      "ユーザーの取得に失敗しました",
      "firebase"
    );
  }

  const children = payment.children;

  const newPayment: Firestore.Company["payment"] = {
    ...payment,
    status: user?.status,
  };

  if (parent) {
    newPayment.account = user.account || 0;

    if (!children) {
      newPayment.children = [];
    }
  }

  if (user.freelanceDirect) {
    const freelanceDirect = user.freelanceDirect === "enable" ? true : false;

    newPayment.option = { freelanceDirect };
  }

  if (user.analytics) {
    const analytics = user.analytics === "enable" ? true : false;

    newPayment.option = { analytics };
  }

  await doc.ref
    .set(
      { payment: newPayment },
      {
        merge: true,
      }
    )
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "ユーザーの編集に失敗しました",
        "firebase"
      );
    });

  return children;
};

const updateAlgolia = async (
  user: Data[number],
  child?: string
): Promise<void> => {
  const index = algolia.initIndex("companys");

  const object: NestedPartial<Algolia.Company> = {
    objectID: !child ? user.uid : child,
    plan: user.status !== "canceled" ? "enable" : "disable",
  };

  if (user.freelanceDirect) {
    object.freelanceDirect = user.freelanceDirect;
  }

  if (user.analytics) {
    object.analytics = user.analytics;
  }

  await index
    .partialUpdateObject(object, {
      createIfNotExists: false,
    })
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "ユーザーの編集に失敗しました",
        "algolia"
      );
    });
};
