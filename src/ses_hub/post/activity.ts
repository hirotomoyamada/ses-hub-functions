import * as functions from "firebase-functions";
import { converter, db, location, runtime } from "../../_firebase";
import * as Firestore from "../../types/firestore";
import * as Algolia from "../../types/algolia";
import { dummy, time } from "../../_utils";
import { postAuthenticated } from "./_postAuthenticated";

type Data = {
  index: "matters" | "resources";
  post: Algolia.Matter | Algolia.Resource;
};

type Activity = {
  total: {
    histories: number;
    likes: number;
    outputs: number;
    entries: number;
  };
  today: {
    histories: number;
    likes: number;
    outputs: number;
    entries: number;
  };
  log: {
    index: "companys" | "persons";
    uid: string;
    icon: string;
    display: string;
    type: "likes" | "outputs" | "entries";
    createAt: number;
  }[];
};

type User = {
  index: "companys" | "persons";
  uid: string;
  icon: string;
  display: string;
};

export const fetchPostActivity = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await postAuthenticated({
      context,
      canceled: true,
    });

    const demo = checkDemo(context);

    if (context.auth?.uid !== data.post.uid) {
      throw new functions.https.HttpsError(
        "cancelled",
        "無効なアカウントのため、実行できません"
      );
    }

    const activity: Activity = {
      total: {
        histories: !demo ? 0 : dummy.num(99, 999),
        likes: !demo ? 0 : dummy.num(99, 999),
        outputs: !demo ? 0 : dummy.num(99, 999),
        entries: !demo ? 0 : dummy.num(99, 999),
      },
      today: {
        histories: !demo ? 0 : dummy.num(99),
        likes: !demo ? 0 : dummy.num(99),
        outputs: !demo ? 0 : dummy.num(99),
        entries: !demo ? 0 : dummy.num(99),
      },
      log: [],
    };

    if (!demo) {
      for await (const key of Object.keys(activity)) {
        if (key === "total" || key === "today") {
          for await (const collection of Object.keys(activity[key])) {
            const querySnapshot = await fetchCollectionGroup(
              collection,
              data,
              key
            );

            if (!querySnapshot) continue;

            const count = querySnapshot.docs.length;

            activity[key][
              collection as keyof Activity["today"] | keyof Activity["total"]
            ] = count;
          }
        }

        if (key === "log") {
          for await (const collection of ["likes", "outputs", "entries"]) {
            const querySnapshot = await fetchCollectionGroup(
              collection,
              data,
              key
            );

            if (!querySnapshot) continue;

            for await (const doc of querySnapshot.docs.slice(0, 10)) {
              const ref = doc.ref.parent.parent;

              if (!ref) continue;

              const user = await fetchUser(ref, context).catch(() => {});

              if (!user) continue;

              const { index, uid, icon, display } = user;
              const type = collection as "likes" | "outputs" | "entries";
              const createAt = doc.data().createAt;

              const log: Activity["log"][number] = {
                index: index,
                uid: uid,
                icon: icon,
                display: display,
                type: type,
                createAt: createAt,
              };

              activity[key].push(log);
            }
          }

          activity[key] = activity[key].sort((a, b) => b.createAt - a.createAt);
        }
      }
    } else {
      for (let i = 0; i < 30; i++) {
        const log = createDummy();

        activity.log.push(log);

        activity.log.sort((a, b) => b.createAt - a.createAt);
      }
    }

    return activity;
  });

const createDummy = () => {
  const index = dummy.index();
  const uid = dummy.uid();
  const icon = dummy.icon(index);
  const display = index === "companys" ? dummy.person() : dummy.nickName();
  const type = ["likes", "outputs", "entries"][
    Math.floor(Math.random() * 3)
  ] as "likes" | "outputs" | "entries";
  const createAt = dummy.at("week");

  const log: Activity["log"][number] = {
    index: index,
    uid: uid,
    icon: icon,
    display: display,
    type: type,
    createAt: createAt,
  };

  return log;
};

const fetchUser = async (
  ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  context: functions.https.CallableContext
): Promise<User | undefined> => {
  const doc = await ref
    .withConverter(converter<Firestore.Company | Firestore.Person>())
    .get()
    .catch(() => {});

  if (!doc) return;
  if (!doc.exists) return;

  const data = doc.data();

  if (!data) return;

  const path = ref.path;
  const index = path.substring(0, path.indexOf("/"));
  const uid = path.substring(path.indexOf("/") + 1, path.length);
  const icon = data.icon;
  const profile = data.profile;

  if (index !== "companys" && index !== "persons") return;
  if (!uid) return;

  if ("person" in profile) {
    const display = context.auth?.uid !== uid ? profile.person : "自分";

    if (!display) return;

    return { index, uid, icon, display };
  }

  if ("nickName" in profile) {
    const display = context.auth?.uid !== uid ? profile.nickName : "自分";

    if (!display) return;

    return { index, uid, icon, display };
  }

  return;
};

const fetchCollectionGroup = async (
  collection: string,
  data: Data,
  key: keyof Activity
): Promise<void | FirebaseFirestore.QuerySnapshot<Firestore.Post>> => {
  switch (key) {
    case "total": {
      return await db
        .collectionGroup(collection)
        .withConverter(converter<Firestore.Post>())
        .where("index", "==", data.index)
        .where("objectID", "==", data.post.objectID)
        .where("active", "==", true)
        .orderBy("createAt", "desc")
        .get()
        .catch(() => {});
    }

    case "today": {
      const today = time("day");

      return await db
        .collectionGroup(collection)
        .withConverter(converter<Firestore.Post>())
        .where("index", "==", data.index)
        .where("objectID", "==", data.post.objectID)
        .where("createAt", ">=", today.start)
        .where("createAt", "<=", today.end)
        .orderBy("createAt", "desc")
        .get()
        .catch(() => {});
    }

    case "log": {
      return await db
        .collectionGroup(collection)
        .withConverter(converter<Firestore.Post>())
        .where("index", "==", data.index)
        .where("objectID", "==", data.post.objectID)
        .orderBy("createAt", "desc")
        .get()
        .catch(() => {});
    }

    default:
      return;
  }
};

const checkDemo = (context: functions.https.CallableContext): boolean =>
  context.auth?.uid === functions.config().demo.ses_hub.uid;
