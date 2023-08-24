import * as functions from 'firebase-functions';
import { location, runtime } from '../../_firebase';
import { postAuthenticated } from './_postAuthenticated';
import * as Algolia from '../../types/algolia';
import { log } from '../../_utils';
import { NestedPartial } from '../../types/utils';
import { openai } from '../../_openai';
import { CreateChatCompletionRequestMessage } from 'openai/resources/chat';
import { APIError } from 'openai';
import { CompletionUsage } from 'openai/resources';

type Posts = NestedPartial<Algolia.Matter>[] | NestedPartial<Algolia.Resource>[];

export type Data = {
  index: 'matters' | 'resources';
  content: string;
};

export const completePost = functions
  .region(location)
  .runWith(runtime)
  .https.onCall(async ({ index, content }: Data, context) => {
    await postAuthenticated({ context, canceled: true });

    let errors: Object[] = [];

    const contents = content
      .split(/(\S)\1{4,}/)
      .filter((v) => v.trim() !== '' && v.length > 1)
      .map((v) => v.trim());

    const data = await Promise.all(
      contents.map(async (content, i) => {
        try {
          const { posts, usage } = await createData({ index, content });

          return { posts, usage };
        } catch (e) {
          const n = i + 1;
          const label = index === 'matters' ? '案件' : '人材';

          if (e instanceof APIError) {
            if (e.error) errors = [...errors, e.error];

            if (e.code === 'context_length_exceeded') {
              throw new functions.https.HttpsError(
                'unavailable',
                `${n}件目の${label}情報の文字数が上限を超えました`,
                'openai',
              );
            } else {
              throw new functions.https.HttpsError(
                'unavailable',
                `${n}件目の${label}情報の作成に失敗しました`,
                'openai',
              );
            }
          }

          return undefined;
        }
      }),
    );

    const { posts, usages } = data.filter(Boolean).reduce(
      (prev, { posts, usage } = { posts: [], usage: undefined }) => {
        prev.posts = [...prev.posts, ...posts] as Posts;
        prev.usages = [...prev.usages, usage];

        return prev;
      },
      { posts: [], usages: [] } as { posts: Posts; usages: (CompletionUsage | undefined)[] },
    );

    await log({
      auth: { collection: 'companys', doc: context.auth?.uid },
      run: 'createAIPost',
      index,
      code: 200,
    });

    return { index, posts, usages, errors };
  });

const industry = [
  'SI・業務系',
  '通信',
  '銀行・証券・保険',
  'ゲーム',
  'WEBサービス',
  'EC',
  'エンタメ',
  '広告',
  'メーカー',
  '流通・小売',
  '公共・官公庁',
  '医療・福祉',
  'その他',
];

const position = [
  'フロントエンドエンジニア',
  'バックエンドエンジニア',
  'サーバーエンジニア',
  'ブロックチェーンエンジニア',
  'インフラエンジニア',
  'データベースエンジニア',
  'クラウドエンジニア',
  'ネットワークエンジニア',
  'セキュリティエンジニア',
  'リードエンジニア',
  'システムエンジニア',
  '社内SE',
  'アプリエンジニア',
  'iOSエンジニア',
  'Androidエンジニア',
  '機械学習エンジニア',
  'AIエンジニア(人工知能)',
  '汎用機エンジニア',
  'マークアップエンジニア',
  'テストエンジニア',
  'テスター・デバッガー・QA',
  '組み込み・制御',
  'データサイエンティスト',
  'PdM',
  'PM',
  'PMO',
  'VPoE',
  'CRE',
  'SRE',
  'エンジニアリングマネージャー',
  'SAP',
  'プロデューサー',
  'コンサルタント',
  'マーケター',
  'Webディレクター',
  'Webプランナー',
  'Webデザイナー',
  'UI・UXデザイナー',
  'グラフィックデザイナー',
  '3Dデザイナー',
  '2Dデザイナー',
  'キャラクターデザイナー',
  'イラストレーター',
  'アートディレクター',
  'ゲームプランナー',
  'ゲームデザイナー',
  'サポート',
  'その他',
];

const area = [
  '渋谷区',
  '新宿区',
  '千代田区',
  '中央区',
  '品川区',
  '目黒区',
  '港区',
  '足立区',
  '文京区',
  '台東区',
  '墨田区',
  '江東区',
  '大田区',
  '世田谷区',
  '中野区',
  '杉並区',
  '豊島区',
  '北区',
  '荒川区',
  '板橋区',
  '練馬区',
  '葛飾区',
  '江戸川区',
  '23区内',
  '23区外',
  '神奈川県',
  '千葉県',
  '埼玉県',
  '大阪府',
  '京都府',
  '奈良県',
  '兵庫県',
  '滋賀県',
  '愛知県',
  '広島県',
  '福岡県',
  '宮城県',
  'その他',
];

const handleOrTool = [
  'Java',
  'PHP',
  'Python',
  'Ruby',
  'Go',
  'Scala',
  'Perl',
  'JavaScript',
  'HTML',
  'Swift',
  'Objective-C',
  'Kotlin',
  'Unity',
  'Cocos2d-x',
  'C',
  'C',
  'VC',
  'C#.NET',
  'VB.NET',
  'VB',
  'VBA',
  'SQL',
  'PL/SQL',
  'R',
  'COBOL',
  'Apex',
  'ASP.NET',
  'TypeScript',
  'Stylus',
  'ESLint',
  'Vuex',
  'Rust',
  'Dart',
  'Node.js',
  'CakePHP',
  'Ruby on Rails',
  'Spring',
  'Django',
  'FuelPHP',
  'Struts',
  'Catalyst',
  'Spark',
  'CodeIgniter',
  'Symfony',
  'Zend Framework',
  'Flask',
  'Pyramid',
  'Kohana',
  'CherryPy',
  'Seasar2',
  'Backbone.js',
  'Knockout.js',
  'AngularJS',
  'Laravel',
  'SAStruts',
  'React',
  'Vue.js',
  'Phalcon',
  'ReactNative',
  'SpringBoot',
  'Slim',
  'Yii',
  'Ethna',
  'Tornado',
  'Ember.js',
  'Flutter',
  'NET Core',
  'Bulma',
  'NuxtJS',
  'RSpec',
  'Flight',
  'Swing',
  'Next.js',
  'FastAPI',
];

const interviews = {
  type: ['オンライン', '現地', 'その他'],
  count: ['1回', '2回', 'その他'],
  setting: ['当日中', '1営業日以内', '3営業日以内', '不明'],
};

const costs = {
  type: ['スキル見合', '上振れ', '応談'],
};

const adjustment = ['140h 〜 180h', '160h 〜 200h', '140h 〜 200h', 'その他'];

const distribution = ['プライム', '二次請け', '三次請け', '営業支援', 'その他'];

const span = ['30', '35', '40', '45', '50', '60', 'その他'];

const approval = ['当日中', '翌営業1日以内', '翌営業3日以内', '不明'];

const sex = ['男性', '女性', 'その他'];

const belong = ['弊社社員', '1社先社員', '直個人事業主', '1社先個人事業主', 'その他'];

const parallel = ['あり', 'なし', '提案中'];

const commonPrompt = `
ユーザーから送られる文章を下記のルールを遵守し、区切られた文章ごとにオブジェクトに変換し、JSON形式の配列で出力する。

ルール
- 文章は、項目から該当または類似するものを抽出する。
- オブジェクトのキーは、項目名の()で囲われている英字を使用する。
- 文章内に項目が含まれていない場合、その項目は空の文字列または項目の補足で指定されている値を出力する。
- 項目に該当または類似しないものは、備考に記載する。

ポジション
${position.map((v) => '- ' + v).join('\n')}

言語・フレームワーク・ツール
${handleOrTool.map((v) => '- ' + v).join('\n')}
`;

const matterPrompt = `
業界
${industry.map((v) => '- ' + v).join('\n')}

エリア
${area.map((v) => '- ' + v).join('\n')}

精算
${adjustment.map((v) => '- ' + v).join('\n')}

商流
${distribution.map((v) => '- ' + v).join('\n')}

支払いサイト
${span.map((v) => '- ' + v).join('\n')}

稟議速度
${approval.map((v) => '- ' + v).join('\n')}

項目
- 案件名(title)
- 業界(industry)
  - 業界に該当または類似している項目を出力する。
  - 該当しない場合は、空の文字列を出力する。
- ポジション(position)
  - ポジションに該当または類似している項目を出力する。
  - 該当しない場合は、空の文字列を出力する。
- 案件詳細(body)
  - 概要または内容が無い場合は、280字以内で案件のPR文を作成し出力すること。
- 勤務地(location)
  - 都道府県(area)
    - エリアに該当または類似している項目を出力する。
    - 該当しない場合は、'その他'を出力する。
  - 地名(place)
    - 都道府県や東京23区に該当しない勤務地の補足を出力する。
- リモート(remote)
  - 'あり','なし'で出力する。
  - 該当しない場合は、'あり'を出力する。
- 開始時期(period)
  - 期間がある場合は、期間が開始する時期を開始時期とする。
  - 年(year)
    - yyyy形式で出力する。
    - 該当しない場合は、2023を出力する。
  - 月(month)
    - mm形式で出力する。
    - 該当しない場合は、8を出力する。
- 就業時間(times)
  - 開始時間(start)
    - 'hh:mm'形式で出力する。
    - 該当しない場合は、'10:00'を出力する。
  - 終了時間(end)
    - 'hh:mm'形式で出力する。
    - 該当しない場合は、'19:00'を出力する。
- 言語・フレームワーク(handles)
  - 文章内で言語・フレームワーク・ツールに該当または類似している単語を必ず選定し配列で出力する。
  - 該当しない場合は、空の配列にする。
- ツール(tools)
  - 文章内で言語・フレームワーク・ツールに該当または類似している単語を必ず選定し配列で出力する。
  - 該当しない場合は、空の配列にする。
- 必須スキル(requires)
  - 文章ごとに配列で出力する。
  - 文章の先頭に'・'が含まれている場合は、消す。
  - 該当しない場合は、空の配列にする。
- 歓迎・尚可スキル(prefers)
  - 文章ごとに配列で出力する。
  - 該当しない場合は、空の配列にする。
  - 文章の先頭に'・'が含まれている場合は、消す。
- 面談(interviews)
  - 方法(type)
    - 面談の方法
    - ${interviews.type.map((v) => `'${v}'`).join(',')}に該当または類似している項目を出力する。
    - 該当しない場合は、'その他'を出力する。
  - 回数(count)
    - 面談の回数
    - ${interviews.count.map((v) => `'${v}'`).join(',')}に該当または類似している項目を出力する。
    - 該当しない場合は、'その他'を出力する。
  - 実施(setting)
    - 面談を実施する時期。
    - ${interviews.setting.map((v) => `'${v}'`).join(',')}に該当または類似している項目を出力する。
    - 該当しない場合は、空の文字列を出力する。
- 単価(costs)
  - 単価に振り幅がない場合は、最小をnullにすること。
  - 最小(min)
    - 単価の最小値をNumber型で出力する。
    - 万以下は省略する。
  - 最大(min)
    - 単価の最大値をNumber型で出力する。
    - 万以下は省略する。
  - 非表示(display)
    - 最小または最大が存在する場合は、'public'とする。
    - 最小または最大が存在しない場合は、'private'とする。
  - 種別(type)
    - ${costs.type.map((v) => `'${v}'`).join(',')}に該当または類似している項目を出力する。
    - 該当しない場合は、'スキル見合'を出力する。
- 精算(adjustment)
  - 精算に該当または類似している項目を出力する。
  - 該当しない場合は、'その他'を出力する。
- 商流(distribution)
  - 商流に該当または類似している項目を出力する。
  - 該当しない場合は、'その他'を出力する。
- 支払いサイト(span)
  - 支払いサイトに該当または類似している項目を出力する。
  - 該当しない場合は、'その他'を出力する。
- 稟議速度(approval)
  - 稟議速度に該当または類似している項目を出力する。
  - 該当しない場合は、'その他'を出力する。
- 備考(note)
`;

const resourcePrompt = `
項目
- 氏名(roman)
  - 姓(lastName)
    - 大文字の英字で出力すること。
    - 該当しない場合は、空の文字列を出力する。
  - 名(firstName)
    - 大文字の英字で出力すること。
    - 該当しない場合は、空の文字列を出力する。
- ポジション(position)
  - ポジションに該当または類似している項目を出力する。
  - 該当しない場合は、空の文字列を出力する。
- 性別(sex)
  - ${sex.map((v) => `'${v}'`).join(',')}に該当または類似している項目を出力する。
  - 該当しない場合は、'その他'を出力する。
- 年齢(age)
  - 18歳から65歳までの該当する年齢をNumber型で出力する。
  - 該当しない場合は、18を出力する。
- PR文(body)
  - 360文字以内で人材のPR文を作成し出力すること。
- 所属(belong)
  - ${belong.map((v) => `'${v}'`).join(',')}に該当または類似している項目を出力する。
  - 該当しない場合は、'その他'を出力する。
- 最寄駅(station)
  - 駅名の最後に'駅'がない場合は、駅名の最後に'駅'をつける。
- 稼働可能時期(period)
  - 稼働や入場稼働日や参画時期または就業可能日もこの項目に該当する。
  - 期間がある場合は、期間が開始する時期を稼働可能時期とする。
  - 年(year)
    - yyyy形式で出力する。
    - 該当しない場合は、2023を出力する。
  - 月(month)
    - mm形式で出力する。
    - 該当しない場合は、8を出力する。
- 単価(costs)
  - 単価に振り幅がない場合は、最小をnullにすること。
  - 最小(min)
    - 単価の最小値をNumber型で出力する。
    - 万以下は省略する。
  - 最大(min)
    - 単価の最大値をNumber型で出力する。
    - 万以下は省略する。
  - 非表示(display)
    - 最小または最大が存在する場合は、'public'とする。
    - 最小または最大が存在しない場合は、'private'とする。
  - 種別(type)
    - '応談'と出力する。
- 言語・フレームワーク(handles)
  - 文章内で言語・フレームワーク・ツールに該当または類似している単語を必ず選定し配列で出力する。
  - 該当しない場合は、空の配列にする。
- ツール(tools)
  - 文章内で言語・フレームワーク・ツールに該当または類似している単語を必ず選定し配列で出力する。
  - 該当しない場合は、空の配列にする。
- スキル(skills)
  - 文章ごとに配列で出力する。
  - 文章の先頭に'・'が含まれている場合は、消す。
  - 該当しない場合は、空の配列にする。
- 並行(parallel)
  - ${parallel.map((v) => `'${v}'`).join(',')}に該当または類似している項目を出力する。
  - 該当しない場合は、'なし'を出力する。
- 備考(note)
`;

const createData = async ({
  index,
  content,
}: {
  index: 'matters' | 'resources';
  content: string;
}) => {
  const messages: CreateChatCompletionRequestMessage[] = [
    {
      role: 'system',
      content: commonPrompt + (index === 'matters' ? matterPrompt : resourcePrompt),
    },
    { role: 'user', content },
  ];

  const { choices, usage } = await openai.chat.completions.create({
    model: 'gpt-4',
    messages,
    temperature: 0,
  });

  const data = choices[0].message?.content;

  let posts: Posts = JSON.parse(data ?? '[]');

  const defaultValues: NestedPartial<Algolia.Matter> | NestedPartial<Algolia.Resource> = {
    display: 'public',
    status: '新規',
  };

  posts = posts.map((values) => formatPost({ index, post: { ...defaultValues, ...values } }));

  return { posts, usage };
};

const formatPost = ({ index, post }: { index: 'matters' | 'resources'; post: any }) => {
  Object.keys(post).forEach((key) => {
    if (index === 'matters') {
      switch (key) {
        case 'industry':
          if (!industry.includes(post[key])) post[key] = '';
          break;

        case 'position':
          if (!position.includes(post[key])) post[key] = '';
          break;

        case 'location':
          if (!area.includes(post[key].area)) post[key].area = 'その他';
          break;

        case 'times':
          post[key].start = formatTime(post[key].start);
          post[key].end = formatTime(post[key].end);
          break;

        case 'handles':
        case 'tools':
          post[key] = (post[key] as any[]).filter((v) => handleOrTool.includes(v));
          break;

        case 'interviews':
          if (!interviews.type.includes(post[key].type)) post[key].type = 'その他';
          if (!interviews.count.includes(post[key].count)) post[key].count = 'その他';
          if (!interviews.setting.includes(post[key].setting)) post[key].setting = '';
          break;

        case 'costs':
          if (!costs.type.includes(post[key].type)) post[key].type = 'スキル見合';
          break;

        case 'adjustment':
          if (!adjustment.includes(post[key])) post[key] = 'その他';
          break;

        case 'distribution':
          if (!distribution.includes(post[key])) post[key] = 'その他';
          break;

        case 'span':
          if (!span.includes(post[key])) post[key] = 'その他';
          break;

        case 'approval':
          if (!approval.includes(post[key])) post[key] = '不明';
          break;

        default:
          break;
      }
    } else {
      switch (key) {
        case 'position':
          if (!position.includes(post[key])) post[key] = '';
          break;

        case 'sex':
          if (!sex.includes(post[key])) post[key] = 'その他';
          break;

        case 'belong':
          if (!belong.includes(post[key])) post[key] = 'その他';
          break;

        case 'handles':
        case 'tools':
          post[key] = (post[key] as any[]).filter((v) => handleOrTool.includes(v));
          break;

        case 'costs':
          if (!costs.type.includes(post[key].type)) post[key].type = '応談';
          break;

        case 'parallel':
          if (!parallel.includes(post[key])) post[key] = 'その他';
          break;

        default:
          break;
      }
    }
  });

  return post;
};

const formatTime = (time: string) =>
  time.replace(
    /^(\d{1,2}):(\d{2})$/,
    (_, hour: string, minute: string) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
  );
