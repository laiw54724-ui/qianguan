import { useEffect, useState } from 'react';
import { getProject, relationsForChar, sideOf } from '../lib/api';
import { myChars, type MyChar } from '../lib/session';
import { href, navigate, parseSlugInput } from '../lib/nav';

// ---------- 雙圓標記（與 logo-mark.svg 同構：赭圓左上、藍圓右下、交疊處墨色）----------
function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="block shrink-0">
      <circle cx="40" cy="38" r="26" fill="#9E4B2C" />
      <circle cx="60" cy="62" r="26" fill="#2E7E9B" />
      <path d="M 34.04,63.30 A 26,26 0 0,0 65.96,36.70 A 26,26 0 0,0 34.04,63.30 Z" fill="#1D251B" />
    </svg>
  );
}

// ---------- 主視覺雙圓（同構放大版）----------
function Stamp() {
  return (
    <svg
      viewBox="0 0 250 255"
      aria-hidden="true"
      className="block h-auto w-[min(72%,300px)] mt-1.5 mb-7 -ml-[8%] sm:w-[min(52%,260px)] sm:-ml-[4%]"
    >
      <circle cx="96" cy="92" r="76" fill="#9E4B2C" opacity=".92" />
      <circle cx="154.46" cy="162.15" r="76" fill="#7FC0DC" opacity=".92" />
      <path d="M 78.58,165.95 A 76,76 0 0,0 171.88,88.20 A 76,76 0 0,0 78.58,165.95 Z" fill="#3B3A2E" opacity=".95" />
    </svg>
  );
}

// ---------- 進入表單 ----------
function Gate() {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    const slug = parseSlugInput(v);
    if (!slug) {
      setErr('看不出這是哪個企劃——貼上完整連結或企劃 ID 試試。');
      return;
    }
    const p = await getProject(slug);
    if (!p) {
      setErr('找不到這個企劃，確認一下連結或 ID 有沒有打錯。');
      return;
    }
    navigate(`/p/${slug}`);
  };
  return (
    <form
      className="mt-8"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label htmlFor="gate-code" className="block text-[13px] text-[#8A7A6E] mb-[7px]">
        輸入企劃代碼
      </label>
      <div className="flex gap-[9px]">
        <input
          id="gate-code"
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            setErr('');
          }}
          placeholder="ABCD-12"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={80}
          className="flex-1 min-w-0 text-base text-[#33261E] bg-white border-[1.5px] border-[#E8DFD4] rounded-[9px] px-[14px] py-[13px] tracking-[0.16em] placeholder:tracking-[0.16em] placeholder:text-[#C3B7AA] focus:outline-none focus:border-transparent focus:shadow-[0_0_0_2px_#24697F]"
        />
        <button
          type="submit"
          className="text-[15px] font-medium text-[#FBF8F3] bg-[#9E4B2C] hover:bg-[#8A3F23] rounded-[9px] px-[22px] py-[13px] whitespace-nowrap transition-colors"
        >
          進入
        </button>
      </div>
      {err && <p className="mt-2.5 text-sm text-[#A8455E]">{err}</p>}
      <p className="mt-[13px] text-sm text-[#8A7A6E]">
        還沒有企劃？
        <a href={href('/new')} className="text-[#24697F] underline decoration-1 underline-offset-[3px]">
          自己開一個
        </a>
        ，把代碼貼給大家就能開始牽線。或先
        <a href={href('/home')} className="text-[#24697F] underline decoration-1 underline-offset-[3px]">
          逛逛公開企劃
        </a>
        。
      </p>
    </form>
  );
}

// ---------- 回訪：我的角色 ----------
interface MineRow extends MyChar {
  pending: number;
}

function Mine() {
  const [rows, setRows] = useState<MineRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = myChars();
      const out: MineRow[] = [];
      for (const c of list) {
        const rels = await relationsForChar(c.slug, c.charId).catch(() => []);
        const pending = rels.filter((r) => r.status === 'pending' && sideOf(r, c.charId) !== r.initiator).length;
        out.push({ ...c, pending });
      }
      if (alive) setRows(out);
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section className="border-t border-[#E8DFD4] py-6">
      <h2 className="font-logo text-[19px] mb-3">我的角色</h2>
      <ul className="list-none m-0 p-0">
        {rows.map((c) => (
          <li
            key={`${c.slug}/${c.charId}`}
            className="flex items-baseline gap-2.5 py-[9px] border-b border-[#E8DFD4] last:border-b-0"
          >
            <a
              href={href(`/p/${c.slug}/c/${c.charId}`)}
              className="text-[#33261E] no-underline font-medium hover:text-[#9E4B2C] transition-colors"
            >
              {c.name}
            </a>
            {c.pending > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#F5AEBD] text-[#6B2438] whitespace-nowrap">
                {c.pending} 則待回應
              </span>
            )}
            <span className="text-[13px] text-[#8A7A6E] ml-auto text-right">{c.projectTitle}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- 辭典 ----------
function Lexicon() {
  return (
    <section className="border-t border-[#E8DFD4] pt-[26px] pb-1">
      <h2 className="font-logo text-[34px] sm:text-[40px] leading-[1.2] mb-3.5">牽關</h2>
      <dl className="m-0 mb-5 border-t border-[#E8DFD4]">
        {[
          ['注　　音', 'ㄑㄧㄢ　ㄍㄨㄢ'],
          ['漢語拼音', 'qiān guān'],
          ['相 似 詞', '結緣、看對眼、預謀相遇'],
        ].map(([dt, dd]) => (
          <div key={dt} className="flex gap-3.5 py-[7px] border-b border-[#E8DFD4] text-sm leading-relaxed">
            <dt className="shrink-0 basis-[5.4em] text-[13px] text-[#8A7A6E]">{dt}</dt>
            <dd className={`m-0 text-[#33261E] ${dt === '漢語拼音' ? 'italic tracking-[0.04em]' : ''}`}>{dd}</dd>
          </div>
        ))}
      </dl>
      <ol className="m-0 p-0 list-none">
        {[
          {
            def: '你們四目相交，意識到彼此的存在。指在廣大人海中，從毫無交集到命運齒輪開始轉動，原本的平行線突然被強行打了個死結的情形。',
            eg: '在開學典禮上的那次四目相交就是我們牽關的瞬間，從此我的視線就再也沒離開過你。',
          },
          {
            def: '企劃參與者間的專門用語。指為了合理化雙方未來發展出愛恨情仇，而刻意建立的初始連結。',
            eg: '為了在這個企劃裡有正當理由可以每天跑去煩你，我可是費盡心機才跟你成功牽關。',
          },
        ].map((s, i) => (
          <li key={i} className="relative pl-[1.9em] mb-5">
            <span
              aria-hidden="true"
              className="absolute left-0 top-[0.28em] w-[1.35em] h-[1.35em] rounded-full bg-[#24697F] text-[#FBF8F3] text-xs leading-[1.35em] text-center"
            >
              {i + 1}
            </span>
            {s.def}
            <span className="block mt-[7px] text-[#4A3B31] text-sm pl-[0.9em] border-l-2 border-[#F5AEBD]">
              <b className="text-[#A8455E] font-medium mr-2">例</b>
              {s.eg}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- 三點說明 ----------
const HOW: Array<[string, string]> = [
  ['不用註冊', '建好角色會拿到一組編輯碼。同一支手機會自動記得你，換裝置或清掉瀏覽資料時，用編輯碼就能回來。'],
  ['關係是雙向的', '對方送出邀請後，經過你的同意，這條關係才會出現在企劃裡。'],
  ['不用再翻聊天紀錄', '誰更新了設定、誰跟誰牽上線、誰剛加入，企劃頁一眼看完。'],
];

// ---------- 海報首頁（辭典紙本風）----------
export default function Poster() {
  return (
    <div className="min-h-screen">
      <div className="max-w-[640px] mx-auto px-[22px]">
        <header className="flex items-center gap-[9px] pt-5">
          <Mark />
          <b className="font-logo text-[17px]">牽關</b>
        </header>

        <main>
          <section className="pt-3.5 pb-[34px]">
            <Stamp />
            <h1 className="font-logo !tracking-[0.02em] !leading-[1.32] text-[clamp(31px,9.2vw,50px)] mb-[18px] max-w-[14em]">
              兩個存在以上，才能建立交集。
            </h1>
            <p className="m-0 max-w-[30em] text-[#4A3B31]">你寫你眼中的他，他寫他眼中的你——牽一條條關係線。</p>
            <Gate />
          </section>

          <Mine />
          <Lexicon />

          <section className="border-t border-[#E8DFD4] pt-[26px] pb-2">
            <dl className="m-0">
              {HOW.map(([dt, dd]) => (
                <div key={dt}>
                  <dt className="font-logo text-[17px] text-[#9E4B2C] mb-1">{dt}</dt>
                  <dd className="m-0 mb-[22px] max-w-[32em] text-[#4A3B31]">{dd}</dd>
                </div>
              ))}
            </dl>
          </section>
        </main>

        <footer className="border-t border-[#E8DFD4] pt-5 pb-10 text-[13px] text-[#8A7A6E]">
          牽關是{' '}
          <a href="https://lorevu.com" className="text-[#8A7A6E] underline decoration-1 underline-offset-[3px]">
            Lorevu
          </a>{' '}
          的一部分。你的角色與世界，值得一個家。
        </footer>
      </div>
    </div>
  );
}
