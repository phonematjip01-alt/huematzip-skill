// Vercel 서버리스 함수 - 카카오 i 오픈빌더 스킬 서버
// 파일 위치: api/skill.js (이 경로 그대로 유지해야 https://프로젝트명.vercel.app/api/skill 로 접근됨)

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSuQY8-cFFoPEjpgrmnFEfoHB3QoKWU0edb0MfSC2YiTSvzTYGN4OHeePZownqPZA/pub?gid=1809262675&single=true&output=csv";

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

  for (let r = 1; r < lines.length; r++) {
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
  output += "대리점 추가지원금: -" + 추가지원금.toLocaleString() + "원\n";
  output += "─────────────\n";
  output += "실구매가: " + 공시가.toLocaleString() + "원\n\n";
  output += "[선택약정 방식]\n";
  output += "출고가: " + 출고가.toLocaleString() + "원\n";
  output += "선택약정 할인(" + 약정개월 + "개월): -" + 약정할인총액.toLocaleString() + "원\n";
  output += "대리점 추가지원금: -" + 추가지원금.toLocaleString() + "원\n";
  output += "─────────────\n";
  output += "실구매가: " + 약정가.toLocaleString() + "원\n\n";
  output += "문의: https://huematzip.store/";

  return output;
}

function kakaoResponse(text) {
  return {
    version: "2.0",
    template: {
      outputs: [{ simpleText: { text } }]
    }
  };
}

export default async function handler(req, res) {
  try {
    const body = req.body;
    const utterance = body?.userRequest?.utterance || "";

    let reply = await buildPriceReply(utterance);
    if (!reply) {
      reply = "모델명, 통신사, 가입유형을 순서 상관없이 입력해주세요.\n예) S26 SKT 번호이동";
    }

    res.status(200).json(kakaoResponse(reply));
  } catch (err) {
    res.status(200).json(kakaoResponse("오류가 발생했어요: " + String(err)));
  }
}
