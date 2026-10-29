/**
 * 첨부 인사평가표(PDF 5종)를 분석해 구성한 평가 양식 원본 데이터.
 *  - 1. 인사고과표_관리직팀원      → office_member
 *  - 2. 인사고과표_관리직팀장&임원  → office_leader
 *  - 3. 팀장평가표_공통            → common (상향평가, stage = upward)
 *  - 4. 인사고과표_생산직팀원      → production_member
 *  - 5. 인사고과표_생산직팀장      → production_leader
 * 점수 체계: A 5점 / B 4점 / C 3점 / D 2점 / E 1점, 평정요소 배점은 소속 문항에 균등 분배.
 * 첨부 파일 외 문항은 없음(모든 문항 is_sample = 0). 자기관찰·의견·건의사항은 점수 미반영.
 */

export type QType =
  | 'short_text' | 'long_text' | 'single_choice' | 'checkbox'
  | 'dropdown' | 'score_scale' | 'linear_scale' | 'descriptive';

export interface TemplateQuestion {
  type: QType;
  text: string;
  description?: string;
  required: boolean;
  points: number;
  scored: boolean;
  options?: { label: string; score: number }[];
  settings?: Record<string, unknown>;
  is_suggestion?: boolean;
}
export interface TemplateSection {
  title: string;
  description?: string;
  questions: TemplateQuestion[];
}
export interface FormTemplate {
  stage: 'self' | 'leader' | 'exec' | 'upward';
  job_group: string;
  name: string;
  description: string;
  source: string;
  sections: TemplateSection[];
}

export const GRADE_OPTIONS = [
  { label: 'A', score: 5 },
  { label: 'B', score: 4 },
  { label: 'C', score: 3 },
  { label: 'D', score: 2 },
  { label: 'E', score: 1 },
];

const choice = (labels: string[]) => labels.map((label) => ({ label, score: 0 }));

/** 평정요소(배점) → 섹션. 배점을 문항 수로 균등 분배 */
function element(category: string, name: string, points: number, items: string[]): TemplateSection {
  const per = Math.round((points / items.length) * 10000) / 10000;
  return {
    title: category === name ? name : `${category} · ${name}`,
    description: `배점 ${points}점 (A~E 5단계)`,
    questions: items.map((text) => ({
      type: 'score_scale', text, required: true, points: per, scored: true, options: GRADE_OPTIONS,
    })),
  };
}

const CUSTOMER = [
  '고객(직원)들이 (피평가자를) 신뢰하고 있다',
  '고객(직원)들과의 의사소통(수정 사항 협의, 요구 사항, 일정 등)이 원활하다',
  '고객(직원)들의 불합리한 요청에도 적절한 방식으로 대응하며, 합의 가능한 중재안을 도출한다',
  '고객(직원)들의 요청에 즉각적이며 적극적으로 응대한다',
];
const OFFICE_QQ = [
  '평가대상기간 중 수행한 업무량이 다른 직원들에 비해 상대적으로 많다',
  '업무를 처리하는 속도가 다른 직원들에 비해 신속하며 정확하다',
  '완성된 업무의 품질이 다른 직원들에 비해 상대적으로 우수하다',
  '업무 처리가 정확하고 실수가 없거나 적으며, 결과물을 신뢰할 수 있다',
  '규정된 프로세스를 준수하기 위해 노력한다',
];
const OFFICE_DIFF = [
  '다른 직원들이 힘들어 하는 업무도 비교적 성공적으로 수행해 낸다',
  '어려운 업무도 포기하지 않고 해결방안을 찾기 위해 스스로 노력한다',
  '업무적 중압감을 잘 이겨내고, 자기 감정을 조절하여, 업무 수행을 일관되게 유지한다',
];
const OFFICE_MGMT = [
  '업무 계획을 적절하게 수립하여 주어진 업무를 효율적으로 수행하고 완료한다',
  '업무를 규정된 시간 내에 처리하려고 노력한다',
  '업무관련 정보(자료)의 분류, 정리, 보관이 체계적이며 기록 및 관리가 잘 이루어진다',
  '자료/메일이 체계적으로 관리되어, 관련자가 쉽게 검색할 수 있고, 부재/비상시 대응이 가능하다',
];
const PROD_QQ = [
  '평가대상기간 중 수행한 작업이 다른 직원들에 비해 상대적으로 많다',
  '작업을 수행하는 속도가 다른 직원들에 비해 신속하며 정확하다',
  '완성된 작업의 품질이 다른 직원들에 비해 상대적으로 우수하다',
  '작업의 처리가 정확하고 실수가 없거나 적으며, 결과물을 신뢰할 수 있다',
  '안전수칙 및 규정된 프로세스를 준수하기 위해 노력한다',
];
const PROD_DIFF = [
  '다른 직원들이 힘들어 하는 작업도 비교적 성공적으로 수행해 낸다',
  '어려운 작업도 포기하지 않고 해결방안을 찾기 위해 스스로 노력한다',
  '업무적 중압감을 잘 이겨내고, 자기 감정을 조절하여, 작업 수행을 일관되게 유지한다',
];
const PROD_MGMT = [
  '생산 계획을 적절하게 수립하여 주어진 작업을 효율적으로 수행하고 완료한다',
  '작업을 규정된 시간 내에 처리하려고 노력한다',
  '작업관련 정보(자료)의 분류, 정리, 보관이 체계적이며 기록 및 관리가 잘 이루어진다',
  '자신의 작업 공간이 정돈되어 있으며 공구 및 설비의 관리가 잘 이루어진다',
  '다른 작업자가 부재/비상시 대응이 가능하다',
];
const DECISIVE = '업무과제를 신속, 정확하게 해결하는 판단력과 합리적인 의사결정을 내릴 수 있는 결단력이 있다';
const JUDGE = [
  '자신의 직무를 정확하게 파악하고 실행한다',
  '회사의 방향과 팀의 목표 등을 정확하게 이해하고 수행한다',
  '위기상황에서 위기관리 및 대처 능력이 있다',
];
const OFFICE_JOB = [
  '업무를 원활하게 수행할 수 있는 지식 또는 기능을 보유하고 있다',
  '직무능력을 향상시키기 위해 적극적으로 노력한다',
  '업무를 익히는 속도가 빠르고 직무 능력이 뛰어나다',
];
const OFFICE_COMM = [
  '의사소통 능력이 뛰어나고 상대방을 설득하는 능력이 있다',
  '프리젠테이션을 잘 수행할 수 있다',
  '혼자서 일을 처리하기 보다는 동료들과 협업하여 보다 효율적으로 일을 처리하려 한다',
];
const OFFICE_ETC = [
  '직무와 관련된 문제점, 개선사항 등을 정확하게 분석하여 보고한다',
  '직무와 관련된 정보를 분류하고 분석하는 능력이 있다',
  '보고서 등 업무관련 문서의 작성 능력이 뛰어나다',
  '중요한 사항들을 잘 기억하고 관리할 줄 아는 능력이 있다',
];
const PROD_JOB = [
  '작업을 원활하게 수행할 수 있는 지식 또는 기능을 보유하고 있다',
  '작업능력을 향상시키기 위해 적극적으로 노력한다',
  '작업을 익히는 속도가 빠르고 작업 능력이 뛰어나다',
];
const PROD_COMM = [
  '의사소통 능력이 뛰어나고 상대방을 설득하는 능력이 있다',
  '혼자서 일을 처리하기 보다는 동료들과 협업하여 보다 효율적으로 일을 처리하려 한다',
];
const PROD_ETC = [
  '작업과 관련된 문제점, 개선사항 등을 정확하게 분석하여 보고한다',
  '작업과 관련된 정보를 분류하고 분석하는 능력이 있다',
  '중요한 사항들을 잘 기억하고 관리할 줄 아는 능력이 있다',
];
const ATTITUDE = [
  '보고 없이 또는 불분명한 사유로 지각, 조퇴, 외출, 결근 등을 하지 않는다',
  '보고없이 근무지를 무단이탈하여 업무에 지장을 주지 않는다',
  '업무 시간에 개인적인 대화, 메신저, 게임, 동영상 시청 등을 하지 않으며 업무 집중도가 높다',
];
const SECURITY = ['대외비 자료가 유출되지 않도록 주의를 기울인다', '회사와 부서의 규정, 규칙을 준수한다'];
const SAFETY = '안전사고 방지 및 안전규정을 철저히 준수하고 개선해나간다';
const CULTURE_TAIL = '개인과 부서의 이익만 추구하지 않고 회사 전체의 이익을 위하여 매사에 적극적으로 행동한다';
const LEAD_MGMT = [
  '팀원들에 대한 리더십이 뛰어나고, 신뢰와 존경을 받는다',
  '팀원 각각의 능력을 발휘할 수 있도록 지도한다',
  '팀원과의 소통이 잘 이루어지며 즐겁게 일할 수 있는 분위기를 조성할 수 있다',
  '관리자로서 필요한 직무 능력을 갖추고 있다',
  '팀원들을 차별하지 않으며 공정하게 대우한다',
  '팀원의 장단점과 능력을 정확하게 파악하고 적절하게 업무를 부여한다',
  '팀원의 업무에 대한 피드백이 적절히 이루어지고 있다',
  '팀원의 업무 능력이 향상될 수 있도록 직무교육 또는 외부교육을 제공한다',
];
const LEAD_CULTURE = [
  '팀원간의 갈등해결을 위한 대안을 제시하며 해결할 수 있다',
  '팀원간의 협조를 포함하여 부서간의 협조가 적절하게 이루어질 수 있도록 업무 관계를 유지한다',
  '회사 전체의 이익을 위하여 협업하는 분위기를 조성한다',
];
const LEAD_INNOV = [
  '부서의 발전을 위해서 문제점을 개선하고 새로운 아이디어를 개발한다',
  '조직의 변화에 효과적으로 대응하며 조직의 목표를 수립하고 수행할 수 있다',
  '부서와 회사의 이익을 위하여 중장기적인 목표를 계획하고 이를 위한 방법을 연구한다',
  '회사의 방침과 목표를 정확하게 파악하고 부하직원을 지도한다',
];

function selfObservation(): TemplateSection {
  const sat = ['매우 만족', '비교적 만족', '보통이다', '비교적 불만', '매우 불만'];
  const q = (type: QType, text: string, required: boolean, labels?: string[]): TemplateQuestion => ({
    type, text, required, points: 0, scored: false, options: labels ? choice(labels) : undefined,
  });
  return {
    title: '자기관찰',
    description: '점수에 반영되지 않는 자기관찰 항목입니다.',
    questions: [
      q('long_text', '현재 주요 담당 업무', true),
      q('single_choice', '업무의 양', true, ['너무 많다', '약간 많다', '알맞다', '약간 적다', '너무 적다']),
      q('single_choice', '업무의 난이도', true, ['매우 어렵다', '약간 어렵다', '보통이다', '약간 쉽다', '매우 쉽다']),
      q('single_choice', '업무에 대한 적성', true, ['매우 적합', '비교적 적합', '보통이다', '약간 부적합', '매우 부적합']),
      q('single_choice', '업무에 대한 만족도', true, sat),
      q('single_choice', '부서 내 대인 관계', true, sat),
      q('single_choice', '이동희망여부 및 시기', true, ['가급적 빨리', '1년 이내', '2 ~ 3년 후', '현직 유지']),
      q('short_text', '이동 희망시 희망 부서', false),
      q('long_text', '기타 인력관리 등 의견', false),
    ],
  };
}

function selfNarrative(stage: string): TemplateSection {
  return {
    title: '업무성과 · 본인서술형',
    description: '배점 8점 (A~E 5단계)',
    questions: [{
      type: 'descriptive',
      text: stage === 'self' ? '본인의 주요 활동 및 성과 기재' : '본인의 주요 활동 및 성과에 대한 평가',
      description: stage === 'self'
        ? '평가대상기간 중 주요 활동과 성과를 서술하고 A~E 등급을 선택하세요.'
        : '피평가자의 주요 활동 및 성과에 대한 의견을 작성하고 A~E 등급을 선택하세요.',
      required: true, points: 8, scored: true, options: GRADE_OPTIONS,
    }],
  };
}

function closing(stage: string): TemplateSection[] {
  const list: TemplateSection[] = [];
  if (stage !== 'self') {
    list.push({
      title: '평가 의견',
      questions: [{ type: 'long_text', text: '평가 의견', required: false, points: 0, scored: false }],
    });
  }
  list.push({
    title: '기타 건의사항',
    questions: [{
      type: 'long_text', text: '기타 건의사항',
      description: '* 예) 부패, 횡령 등 고발 / 비윤리적 이슈 제보 / 이해관계 상충, 고충 등 (점수 미반영)',
      required: false, points: 0, scored: false, is_suggestion: true,
    }],
  });
  return list;
}

const STAGE_LABEL: Record<string, string> = { self: '자기평가', leader: '팀장평가', exec: '임원평가' };
const GROUP_LABEL: Record<string, string> = {
  office_member: '관리직-팀원',
  office_leader: '관리직-팀장&임원',
  production_member: '생산직-팀원',
  production_leader: '생산직-팀장',
};
const SOURCE: Record<string, string> = {
  office_member: '1. 인사고과표_관리직팀원.pdf',
  office_leader: '2. 인사고과표_관리직팀장&임원.pdf',
  production_member: '4. 인사고과표_생산직팀원.pdf',
  production_leader: '5. 인사고과표_생산직팀장.pdf',
};

function scoredSections(group: string, stage: string): TemplateSection[] {
  const office = group.startsWith('office');
  const leader = group.endsWith('leader');
  const P = '업무성과';
  const A = '능력';
  const s: TemplateSection[] = [selfNarrative(stage)];
  if (office) {
    s.push(element(P, '고객(직원) 만족', 7, CUSTOMER));
    s.push(element(P, '업무의 양과 질', 8, OFFICE_QQ));
    s.push(element(P, '업무의 난이도', 5, OFFICE_DIFF));
    s.push(element(P, '업무관리', 7, OFFICE_MGMT));
    s.push(element(A, '직무능력', 5, OFFICE_JOB));
    s.push(element(A, '소통능력', 5, OFFICE_COMM));
    s.push(element(A, '판단능력', 5, leader ? [...JUDGE, DECISIVE] : JUDGE));
    s.push(element(A, '기타', 5, OFFICE_ETC));
  } else {
    if (leader) {
      s.push(element(P, '고객(직원) 만족', 7, CUSTOMER));
      s.push(element(P, '업무의 양과 질', 8, PROD_QQ));
      s.push(element(P, '업무의 난이도', 5, PROD_DIFF));
      s.push(element(P, '업무관리', 7, PROD_MGMT));
    } else {
      s.push(element(P, '업무의 양과 질', 10, PROD_QQ));
      s.push(element(P, '업무의 난이도', 8, PROD_DIFF));
      s.push(element(P, '업무관리', 9, PROD_MGMT));
    }
    s.push(element(A, '직무능력', 5, PROD_JOB));
    s.push(element(A, '소통능력', 5, PROD_COMM));
    s.push(element(A, '판단능력', 5, leader ? [...JUDGE, DECISIVE] : JUDGE));
    s.push(element(A, '기타', 5, PROD_ETC));
  }
  if (leader) {
    const L = office ? '팀장/임원 리더십' : '팀장 리더십';
    s.push(element(L, '팀원 관리 및 육성', 20, LEAD_MGMT));
    s.push(element(L, '조직문화', 10, LEAD_CULTURE));
    s.push(element(L, '혁신', 15, LEAD_INNOV));
  } else {
    s.push(element('근무태도', '근무태도', 20, ATTITUDE));
    s.push(element('보안,규정 준수', '보안,규정 준수', 10, office ? SECURITY : [...SECURITY, SAFETY]));
    s.push(element('조직문화', '조직문화', 15, [
      office ? '업무 수행에 있어 상사와 동료에게 적극적으로 협조한다' : '작업 수행에 있어 상사와 동료에게 적극적으로 협조한다',
      CULTURE_TAIL,
    ]));
  }
  return s;
}

export function buildTemplates(): FormTemplate[] {
  const list: FormTemplate[] = [];
  for (const group of Object.keys(GROUP_LABEL)) {
    for (const stage of ['self', 'leader', 'exec'] as const) {
      list.push({
        stage,
        job_group: group,
        name: `인사평가표 [${GROUP_LABEL[group]}] ${STAGE_LABEL[stage]}`,
        description: `첨부 양식 「${SOURCE[group]}」 기반 ${STAGE_LABEL[stage]} 양식`,
        source: SOURCE[group],
        sections: [...(stage === 'self' ? [selfObservation()] : []), ...scoredSections(group, stage), ...closing(stage)],
      });
    }
  }
  list.push({
    stage: 'upward',
    job_group: 'common',
    name: '팀장평가표 [공통] (상향평가)',
    description: '팀원이 소속 팀장을 평가하는 상향평가 양식 (첨부 양식 「3. 팀장평가표_공통.pdf」). 최종점수 반영 방식이 원본에 명시되지 않아 참고용으로만 제공됩니다.',
    source: '3. 팀장평가표_공통.pdf',
    sections: [
      element('팀장/임원 리더십', '팀원 관리 및 육성', 40, LEAD_MGMT),
      element('팀장/임원 리더십', '조직문화', 30, LEAD_CULTURE),
      element('팀장/임원 리더십', '혁신', 30, LEAD_INNOV),
      { title: '평가 의견', questions: [{ type: 'long_text', text: '평가의견', required: false, points: 0, scored: false }] },
      ...closing('self'),
    ],
  });
  return list;
}

/** 첨부 양식 기준 차수 가중치: 팀원 20/40/40, 팀장 20/80(2차=임원)/0 */
export const TEMPLATE_WEIGHTS: Record<string, [number, number, number]> = {
  default: [20, 40, 40],
  office_leader: [20, 0, 80],
  production_leader: [20, 0, 80],
};
