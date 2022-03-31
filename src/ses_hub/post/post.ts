import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../firebase";
import { algolia } from "../../algolia";
import { postAuthenticated } from "./_postAuthenticated";
import * as format from "./_format";
import * as Firestore from "../../types/firestore";
import { send } from "../../sendgrid";
import * as body from "../mail";
import * as Algolia from "../../types/algolia";
import { NestedPartial } from "../../types/utils";
import { tweet } from "../../twitter";
import { shortUrl } from "../../bitly";

export type Data = {
  index: "matters" | "resources";
  post: NestedPartial<Algolia.Matter> | NestedPartial<Algolia.Resource>;
};

export type User = {
  name: string;
  person: string;
};

export const createPost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await postAuthenticated({ context });

    const post = await createAlgolia(context, data);

    await updateFirestore({ context, data, post });

    return { index: data.index, post: post };
  });

export const editPost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await postAuthenticated({ context });

    if (context.auth?.uid === data.post.uid) {
      await editAlgolia(context, data);
      await updateFirestore({ context, data, edit: true });
    }
  });

export const deletePost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await postAuthenticated({ context });

    if (context.auth?.uid === data.post.uid) {
      await deleteAlgolia(data);
      await updateFirestore({ context, data });
      await updateCollectionGroup(data);
    }
  });

export const sendPost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await postAuthenticated({
      context: context,
      canceled: true,
    });

    const post = data.post as Algolia.Matter | Algolia.Resource;

    if (post.display === "private") {
      throw new functions.https.HttpsError(
        "cancelled",
        "非公開の投稿のため、処理中止",
        "sendGrid"
      );
    }

    for await (const index of ["companys", "persons"]) {
      if (index === "persons" && data.index === "resources") {
        continue;
      }

      await sendMail(index, data, post);

      // ver 2.X.X 削除予定
      if (index === "persons") {
        await sendTweet(index, data, post);
      }
    }

    return;
  });

const createAlgolia = async (
  context: functions.https.CallableContext,
  data: Data
) => {
  const index = algolia.initIndex(data.index);

  const post =
    data.index === "matters"
      ? format.matter({
          post: data.post as NestedPartial<Algolia.Matter>,
          context,
        })
      : data.index === "resources" &&
        format.resource({
          post: data.post as NestedPartial<Algolia.Resource>,
          context,
        });

  if (!post) {
    throw new functions.https.HttpsError(
      "unavailable",
      "投稿の作成に失敗しました",
      "algolia"
    );
  }

  await index
    .saveObject(post, { autoGenerateObjectIDIfNotExist: true })
    .then(async (result) => {
      post.objectID = result.objectID;
    })
    .catch(() => {
      throw new functions.https.HttpsError(
        "unavailable",
        "投稿の作成に失敗しました",
        "algolia"
      );
    });

  return post as Algolia.Matter | Algolia.Resource;
};

const editAlgolia = async (
  context: functions.https.CallableContext,
  data: Data
) => {
  const index = algolia.initIndex(data.index);

  const post =
    data.index === "matters"
      ? format.matter({
          post: data.post as NestedPartial<Algolia.Matter>,
          context,
          edit: true,
        })
      : data.index === "resources" &&
        format.resource({
          post: data.post as NestedPartial<Algolia.Resource>,
          context,
          edit: true,
        });

  if (!post) {
    throw new functions.https.HttpsError(
      "unavailable",
      "投稿の作成に失敗しました",
      "algolia"
    );
  }

  await index.partialUpdateObject(post).catch(() => {
    throw new functions.https.HttpsError(
      "data-loss",
      "投稿の編集に失敗しました",
      "algolia"
    );
  });

  return;
};

const deleteAlgolia = async (data: Data) => {
  const index = algolia.initIndex(data.index);

  if (!data.post.objectID) {
    throw new functions.https.HttpsError(
      "data-loss",
      "削除する投稿の情報が不足しています",
      "algolia"
    );
  }

  await index.deleteObject(data.post.objectID).catch(() => {
    throw new functions.https.HttpsError(
      "data-loss",
      "投稿の削除に失敗しました",
      "algolia"
    );
  });

  return;
};

const updateFirestore = async ({
  context,
  data,
  post,
  edit,
}: {
  context: functions.https.CallableContext;
  data: Data;
  post?: Algolia.Matter | Algolia.Resource;
  edit?: boolean;
}): Promise<void> => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "認証されていないユーザーではログインできません",
      "auth"
    );
  }

  const timestamp = Date.now();

  const collection = db
    .collection("companys")
    .doc(context.auth.uid)
    .collection("posts")
    .withConverter(converter<Firestore.Post>());

  const querySnapshot = await collection
    .where("index", "==", data.index)
    .where("objectID", "==", post?.objectID || data.post.objectID)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "コレクションの取得に失敗しました",
        "firebase"
      );
    });

  const doc = querySnapshot.docs[0];

  if (doc) {
    await doc.ref
      .set(
        edit
          ? { display: data.post.display, updateAt: timestamp }
          : { active: false, display: "private", deleteAt: timestamp },
        {
          merge: true,
        }
      )
      .catch(() => {
        throw new functions.https.HttpsError(
          "data-loss",
          "データの更新に失敗しました",
          "firebase"
        );
      });
  } else {
    if (!post?.uid || !post?.objectID) {
      throw new functions.https.HttpsError(
        "data-loss",
        "データの追加に失敗しました",
        "firebase"
      );
    }

    await collection
      .add({
        index: data.index,
        uid: post.uid,
        objectID: post.objectID,
        display: post.display,
        active: true,
        createAt: timestamp,
      })
      .catch(() => {
        throw new functions.https.HttpsError(
          "data-loss",
          "データの追加に失敗しました",
          "firebase"
        );
      });
  }

  return;
};

const updateCollectionGroup = async (data: Data) => {
  const collections = ["likes", "outputs", "entries", "histories"];

  for await (const collection of collections) {
    const querySnapshot = await db
      .collectionGroup(collection)
      .withConverter(converter<Firestore.Post>())
      .where("objectID", "==", data.post.objectID)
      .get()
      .catch(() => {
        throw new functions.https.HttpsError(
          "not-found",
          "コレクションの取得に失敗しました",
          "firebase"
        );
      });

    const timestamp = Date.now();

    querySnapshot.forEach(async (doc) => {
      if (doc) {
        await doc.ref
          .set({ active: false, updateAt: timestamp }, { merge: true })
          .catch(() => {});
      }
    });
  }
};

const sendMail = async (
  index: string,
  data: Data,
  post: Algolia.Matter | Algolia.Resource
): Promise<void> => {
  const to = await fetchTo(index, post);

  const user: User = await fetchUser(post);

  const url =
    index === "companys"
      ? `${functions.config().app.ses_hub.url}/${data.index}/${post.objectID}`
      : `${functions.config().app.freelance_direct.url}/post/${post.objectID}`;

  const subject =
    data.index === "matters"
      ? `【新着案件】 ${(post as Algolia.Matter).title}`
      : `【新着人材】 ${(post as Algolia.Resource).roman.firstName.substring(
          0,
          1
        )} . ${(post as Algolia.Resource).roman.lastName.substring(0, 1)}`;

  const text =
    data.index === "matters"
      ? body.post.matter(post as Algolia.Matter, user, url)
      : body.post.resource(post as Algolia.Resource, user, url);

  const from =
    index === "companys"
      ? `SES_HUB <${functions.config().admin.ses_hub}>`
      : `Freelance Direct <${functions.config().admin.freelance_direct}>`;

  const mail = {
    to,
    from,
    subject,
    text,
  };

  await send(mail);
};

const sendTweet = async (
  index: string,
  data: Data,
  post: Algolia.Matter | Algolia.Resource
): Promise<void> => {
  const url = await shortUrl(
    index === "companys"
      ? `${functions.config().app.ses_hub.url}/${data.index}/${post.objectID}`
      : `${functions.config().app.freelance_direct.url}/post/${post.objectID}`
  );

  const txt =
    data.index === "matters"
      ? body.tweet.matter(post as Algolia.Matter, url)
      : body.tweet.resource(post as Algolia.Resource, url);

  index === "companys"
    ? await tweet.seshub(txt)
    : await tweet.freelanceDirect(txt);
};

const fetchUser = async (post: Algolia.Matter | Algolia.Resource) => {
  if (!post.uid) {
    throw new functions.https.HttpsError(
      "data-loss",
      "削除する投稿の情報が不足しています",
      "algolia"
    );
  }

  const doc = await db
    .collection("companys")
    .withConverter(converter<Firestore.Company>())
    .doc(post.uid)
    .get();

  const name = doc.data()?.profile.name;
  const person = doc.data()?.profile.person;

  if (!name || !person) {
    throw new functions.https.HttpsError(
      "data-loss",
      "送信元のユーザーの情報が不足しています",
      "firebase"
    );
  }

  return { name, person };
};

const fetchTo = async (
  index: string,
  post: Algolia.Matter | Algolia.Resource
) => {
  const querySnapshot = await db
    .collection(index)
    .withConverter(converter<Firestore.Company>())
    .where("status", "==", "enable")
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        "not-found",
        "ユーザーの取得に失敗しました",
        "firebase"
      );
    });

  const to = querySnapshot?.docs
    ?.map((doc) => verified(doc, post) && doc.data().profile.email)
    ?.filter((email) => email) as string[];

  return to;
};

const verified = (
  doc: FirebaseFirestore.QueryDocumentSnapshot<
    Firestore.Company | Firestore.Person
  >,
  post: Algolia.Matter | Algolia.Resource
) => {
  const id = doc.id;
  const email = doc.data().profile.email;
  const config = functions.config();

  return (
    post.uid !== id &&
    config.admin.ses_hub !== email &&
    config.admin.freelance_direct !== email &&
    config.demo.ses_hub.email !== email &&
    config.demo.freelance_direct.email !== email &&
    true
  );
};
