import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import { algolia } from "../../_algolia";
import { stripe } from "../../_stripe";
import { userAuthenticated } from "./_userAuthenticated";
import * as Firestore from "../../types/firestore";
import { log } from "../../_utils";

type Data = {
  email: string;
  uid?: string;
};

export const changeEmail = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated({ context, demo: true });

    await editFirestore(context, data);
    await editAlgolia(context, data);
    await editStripe(context, data);

    await log({
      auth: { collection: "companys", doc: context.auth?.uid },
      run: "changeEmail",
      code: 200,
      uid: data.uid || context.auth?.uid,
    });

    return;
  });

const editFirestore = async (
  context: functions.https.CallableContext,
  data: Data
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const timestamp = Date.now();

  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(data.uid || context.auth.uid)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
    });

  if (doc.exists) {
    const profile = Object.assign(doc.data()?.profile, { email: data.email });

    if (profile) {
      await doc.ref
        .set(
          {
            profile: profile,
            updateAt: timestamp,
          },
          { merge: true }
        )
        .catch(() => {
          throw new functions.https.HttpsError(
            "data-loss",
            "メールアドレスの更新に失敗しました",
            "firebase"
          );
        });
    }
  }
};

const editAlgolia = async (
  context: functions.https.CallableContext,
  data: Data
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const index = algolia.initIndex("companys");
  const timestamp = Date.now();

  await index
    .partialUpdateObject(
      {
        objectID: data.uid || context.auth.uid,
        email: data.email,
        updateAt: timestamp,
      },
      {
        createIfNotExists: true,
      }
    )
    .catch(() => {
      throw new functions.https.HttpsError(
        "data-loss",
        "メールアドレスの更新に失敗しました",
        "algolia"
      );
    });
};

const editStripe = async (
  context: functions.https.CallableContext,
  data: Data
): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const doc = await db
    .collection("customers")
    .withConverter(converter<Firestore.Customer>())
    .doc(data.uid || context.auth.uid)
    .get();

  const stripeId = doc.exists && doc.data()?.stripeId;

  if (stripeId) {
    await stripe.customers
      .update(stripeId, {
        email: data.email,
      })
      .catch(() => {
        throw new functions.https.HttpsError(
          "data-loss",
          "メールアドレスの更新に失敗しました",
          "stripe"
        );
      });
  }
};
