// Vercel 서버리스 함수 - 카카오 i 오픈빌더 스킬 서버
// 파일 위치: api/skill.js (이 경로 그대로 유지해야 https://프로젝트명.vercel.app/api/skill 로 접근됨)

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuQY8-cFFoPEjpgrmnFEfoHB3QoKWU0edb0MfSC2YiTSvzTYGN4OHeePZownqPZA/pub?gid=1809262675&single=true&output=csv";
const STOCK_LIST_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuQY8-cFFoPEjpgrmnFEfoHB3QoKWU0edb0MfSC2YiTSvzTYGN4OHeePZownqPZA/pub?gid=170349826&single=true&output=csv";
const LOG_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwdqXEol2vYXhxwraXnxqwiP-6nDqBATIcKVhXu7_Pwhwhc8hw4PkTABd0XxiNKLbBQWQ/exec";

async function logQuery(userId, message, replySummary) {
  try {
    await fetch(LOG_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, message, replySummary })
    });
  } catch (e) {
    // 로그 기록 실패해도 챗봇 응답 자체엔 영향 없게 조용히 무시
  }
}

const VALID_CARRIERS = ["SKT", "KT", "LGU+"];
const VALID_TYPES = ["번호이동", "기기변경", "신규가입"];

function normalizeCarrier(input) {
  const v = String(input).trim().toUpperCase();
  if (v === "SKT" || v === "SK") return "SKT";
  if (v === "KT") return "KT";
  if (v === "LG" || v === "LGU+" || v === "LGUPLUS" || v === "LGU") return "LGU+";
  return v;
}

function normalizeType(input) {
  const v = String(input).trim();
  const upper = v.toUpperCase();
  if (v === "번호이동" || v === "번이" || upper === "MNP") return "번호이동";
  if (v === "기기변경" || v === "기변") return "기기변경";
  if (v === "신규" || v === "신규가입") return "신규가입";
  return v;
}

function makeKey(모델명, 통신사, 가입유형) {
  return String(모델명).trim().toUpperCase() + "_" + 통신사 + "_" + 가입유형;
}

async function loadModelDB() {
  const res = await fetch(SHEET_CSV_URL);
  const text = await res.text();
  const lines = text.split("\n");
  const db = {};

  for (let r = 1; r < lines.length; r++) { // 1행은 헤더라 스킵
    const line = lines[r].trim();
    if (!line) continue;

    const cols = line.split(",");
    const 모델명들 = cols[0].split("/");
    const 통신사 = normalizeCarrier(cols[1]);
    const 가입유형 = normalizeType(cols[2]);
    const 출고가 = Number(cols[3]);
    const 공시지원금 = Number(cols[4]);
    const 추가지원금 = Number(cols[5]);
    const 월요금제 = Number(cols[6]);

    for (const 별칭raw of 모델명들) {
      const 별칭 = 별칭raw.trim();
      const key = makeKey(별칭, 통신사, 가입유형);
      db[key] = {
        출고가, 공시지원금, 추가지원금, 월요금제,
        대표모델명: 모델명들[0].trim()
      };
    }
  }
  return db;
}

const STATIC_REPLIES = {
  "인터넷": "🌐 인터넷·TV 최대 지원금 확인\n\nKT/SKT/LG 인터넷+TV 결합 시\n최대 지원금을 계산해드려요.\n\n👉 https://huematzip.store/internet-calculator-kt\n\n문의: 1688-6476",
  "렌탈": "🏠 가전렌탈 상품 안내\n\n정수기·TV·가전 렌탈을\n한곳에서 비교하고 혜택을 확인하세요.\n\n👉 https://huematzip.store/rental\n\n문의: 1688-6476",
  "매장": "📍 가까운 매장 찾기\n\n주변 성지(매장) 위치와\n상담 연결을 도와드려요.\n\n👉 https://huematzip.store/seongji-check\n\n문의: 1688-6476",
  "공지": "📢 공지사항\n\n최신 소식과 이벤트 안내는\n아래 링크에서 확인하실 수 있어요.\n\n👉 https://huematzip.store/tips"
};

async function buildStockListReply() {
  const res = await fetch(STOCK_LIST_CSV_URL);
  const text = await res.text();
  const lines = text.split("\n").map(l => l.trim()).filter(l => l !== "");

  if (lines.length === 0) {
    return "현재 등록된 재고 목록이 없어요.";
  }

  let output = "📋 현재 개통 가능한 재고 목록\n\n";
  lines.forEach((name) => {
    output += "・" + name + "\n";
  });
  output += "\n모델명 + 통신사 + 가입유형을 입력하시면 가격을 바로 알려드려요.\n예) S26 SKT 번호이동";

  return output;
}

async function buildPriceReply(msg) {
  const parts = msg.trim().split(/\s+/);
  if (parts.length !== 3) return null;

  let 통신사 = null, 가입유형 = null, 모델명 = null;
  const usedIndex = {};

  for (let idx = 0; idx < 3; idx++) {
    const 후보 = parts[idx];
    if (통신사 === null && VALID_CARRIERS.indexOf(normalizeCarrier(후보)) !== -1) {
      통신사 = normalizeCarrier(후보);
      usedIndex[idx] = true;
      continue;
    }
    if (가입유형 === null && VALID_TYPES.indexOf(normalizeType(후보)) !== -1) {
      가입유형 = normalizeType(후보);
      usedIndex[idx] = true;
    }
  }

  if (통신사 === null || 가입유형 === null) return null;

  for (let idx2 = 0; idx2 < 3; idx2++) {
    if (!usedIndex[idx2]) { 모델명 = parts[idx2]; break; }
  }

  const MODEL_DB = await loadModelDB();
  const key = makeKey(모델명, 통신사, 가입유형);
  const info = MODEL_DB[key];

  if (!info) {
    return "해당 조합의 가격 정보가 없어요.\n입력: " + 모델명 + " / " + 통신사 + " / " + 가입유형 +
      "\n\n형식 확인: 모델명, 통신사, 가입유형 3가지를 순서 상관없이 입력해주세요.\n예) S25 SKT 번호이동";
  }

  const 출고가 = info.출고가;
  const 표시모델명 = info.대표모델명;
  const 추가지원금 = info.추가지원금;
  const 약정개월 = 24;

  const 공시가 = 출고가 - info.공시지원금 - 추가지원금;
  const 약정할인총액 = Math.floor(info.월요금제 * 0.25) * 약정개월;
  const 약정가 = 출고가 - 약정할인총액 - 추가지원금;

  let output = "📱 " + 표시모델명 + " (" + 통신사 + " / " + 가입유형 + ")\n\n";
  output += "[공시지원금 방식]\n";
  output += "출고가: " + 출고가.toLocaleString() + "원\n";
  output += "공시지원금: -" + info.공시지원금.toLocaleString() + "원\n";
  output += "매장특별지원금 적용\n";
  output += "─────────────\n";
  output += "실구매가: " + 공시가.toLocaleString() + "원\n\n";
  output += "[선택약정 방식]\n";
  output += "출고가: " + 출고가.toLocaleString() + "원\n";
  output += "선택약정 할인(" + 약정개월 + "개월): -" + 약정할인총액.toLocaleString() + "원\n";
  output += "매장특별지원금 적용\n";
  output += "─────────────\n";
  output += "실구매가: " + 약정가.toLocaleString() + "원\n\n";
  output += "문의: https://huematzip.store/";

  return output;
}

const QUICK_REPLIES = [
  { label: "재고목록", action: "message", messageText: "재고목록" },
  { label: "인터넷", action: "message", messageText: "인터넷" },
  { label: "렌탈", action: "message", messageText: "렌탈" },
  { label: "매장", action: "message", messageText: "매장" },
  { label: "공지", action: "message", messageText: "공지" },
  { label: "상담예약", action: "message", messageText: "상담예약" }
];

async function logConsultation(userId, content) {
  try {
    await fetch(LOG_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "consultation", userId, content })
    });
  } catch (e) {
    // 저장 실패해도 챗봇 응답 자체엔 영향 없게 조용히 무시
  }
}

const CONSULT_GUIDE = "📞 상담 예약 신청\n\n\"상담예약\" 뒤에 이름, 연락처, 희망시간 등\n원하시는 내용을 자유롭게 적어서 보내주세요.\n\n예) 상담예약 홍길동 010-1234-5678 내일 오후 2시쯤 방문 상담 원해요";

function kakaoResponse(text) {
  return {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text } }],
      quickReplies: QUICK_REPLIES
    }
  };
}

// Vercel 서버리스 함수 진입점
export default async function handler(req, res) {
  try {
    const body = req.body;
    const utterance = body?.userRequest?.utterance || "";
    const userId = body?.userRequest?.user?.id || "unknown";

    let reply;
    const trimmed = utterance.trim();

    if (trimmed === "재고목록") {
      reply = await buildStockListReply();
    } else if (STATIC_REPLIES[trimmed]) {
      reply = STATIC_REPLIES[trimmed];
    } else if (trimmed === "상담예약") {
      reply = CONSULT_GUIDE;
    } else if (trimmed.startsWith("상담예약 ")) {
      const content = trimmed.substring("상담예약 ".length).trim();

      if (!content) {
        reply = CONSULT_GUIDE;
      } else {
        await logConsultation(userId, content);
        reply = "상담 예약 신청이 완료됐어요! 😊\n\n남겨주신 내용: " + content + "\n\n확인 후 빠르게 연락드릴게요.";
      }
    } else {
      reply = await buildPriceReply(utterance);
      if (!reply) {
        reply = "재고목록 / 인터넷 / 렌탈 / 매장 / 공지 / 상담예약\n위 단어를 입력하시면 각각 안내해드려요.\n\n가격 조회는 모델명, 통신사, 가입유형을\n순서 상관없이 입력해주세요.\n예) S26 SKT 번호이동";
      }
    }

    // 첫 줄만 요약으로 로그에 남김 (스프레드시트 셀이 너무 길어지지 않게)
    const replySummary = reply.split("\n")[0];
    await logQuery(userId, utterance, replySummary);

    res.status(200).json(kakaoResponse(reply));
  } catch (err) {
    res.status(200).json(kakaoResponse("오류가 발생했어요: " + String(err)));
  }
}
