import * as functions from 'firebase-functions';
import { converter, db, location, runtime } from '../_firebase';
import { algolia } from '../_algolia';
import { userAuthenticated } from './_userAuthenticated';
import * as Algolia from '../types/algolia';
import * as format from './_format';
import * as Firestore from '../types/firestore';

type Data = {
  index: 'matters' | 'resources';
  post: Algolia.Matter | Algolia.Resource;
};

export const editPost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated(context);

    await editAlgolia(data);
    await updateFirestore({ data, edit: true });

    return;
  });

export const deletePost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async (data: Data, context) => {
    await userAuthenticated(context);

    await deleteAlgolia(data);
    await updateFirestore({ data });
    await updateCollectionGroup(data);

    return;
  });

const editAlgolia = async (data: Data): Promise<void> => {
  const index = algolia.initIndex(data.index);
  const post =
    data.index === 'matters'
      ? format.matter(<Algolia.Matter>data.post)
      : data.index === 'resources' &&
        format.resource(<Algolia.Resource>data.post);

  if (!post) {
    throw new functions.https.HttpsError(
      'data-loss',
      '投稿の編集に失敗しました',
      'algolia',
    );
  }

  await index
    .partialUpdateObject(post, {
      createIfNotExists: false,
    })
    .catch(() => {
      throw new functions.https.HttpsError(
        'data-loss',
        '投稿の編集に失敗しました',
        'algolia',
      );
    });
};

const updateFirestore = async ({
  data,
  edit,
}: {
  data: Data;
  edit?: boolean;
}): Promise<void> => {
  const timestamp = Date.now();

  const ref = db.collection('companys').doc(data.post.uid);

  const collection = ref
    .collection('posts')
    .withConverter(converter<Firestore.Post>());

  const querySnapshot = await collection
    .where('index', '==', data.index)
    .where('objectID', '==', data.post.objectID)
    .get()
    .catch(() => {
      throw new functions.https.HttpsError(
        'not-found',
        'コレクションの取得に失敗しました',
        'firebase',
      );
    });

  if (!querySnapshot.docs.length)
    throw new functions.https.HttpsError(
      'not-found',
      '投稿の取得に失敗しました',
      'firebase',
    );

  const doc = querySnapshot.docs[0];

  await doc.ref
    .set(
      edit
        ? { display: data.post.display, updateAt: timestamp }
        : { active: false, display: 'private', deleteAt: timestamp },
      {
        merge: true,
      },
    )
    .catch(() => {
      throw new functions.https.HttpsError(
        'data-loss',
        'データの更新に失敗しました',
        'firebase',
      );
    });

  return;
};

const updateCollectionGroup = async (data: Data) => {
  const collections = ['likes', 'outputs', 'entries', 'histories'];

  await Promise.allSettled(
    collections.map(async (collection) => {
      const querySnapshot = await db
        .collectionGroup(collection)
        .withConverter(converter<Firestore.Post>())
        .where('index', '==', data.index)
        .where('objectID', '==', data.post.objectID)
        .orderBy('createAt', 'desc')
        .get()
        .catch(() => {});

      const timestamp = Date.now();

      if (!querySnapshot) {
        return;
      }

      querySnapshot?.forEach(async (doc) => {
        if (doc) {
          await doc.ref
            .set({ active: false, updateAt: timestamp }, { merge: true })
            .catch(() => {});
        }
      });
    }),
  );
};

const deleteAlgolia = async (data: Data): Promise<void> => {
  const index = algolia.initIndex(data.index);
  await index.deleteObject(data.post.objectID).catch(() => {
    throw new functions.https.HttpsError(
      'data-loss',
      '投稿の削除に失敗しました',
      'algolia',
    );
  });

  return;
};
