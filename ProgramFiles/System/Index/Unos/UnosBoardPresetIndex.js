// ProgramFiles/System/Index/Unos/UnosBoardPresetIndex.js
// 우노스(UNOS) 6x6 색상 체스판 프리셋 테이블 (4색 각 9칸 균등 · 상하좌우 비인접 100% 사전 검증)
// 64종 기본 프리셋 × 8종 대칭/회전(D4) × 24종 색상 순열(4!) = 총 12,288 패턴 O(1) 랜덤/변형 선택기

import { UNOS_PERSONALITY_KEYS } from './UnosCardIndex.js';

export const UNOS_BOARD_SIZE = 6;
export const UNOS_CELLS_PER_COLOR = 9;

// 0: madness(광기), 1: calm(냉정), 2: pure(순수), 3: lively(활발) 기준 사전 검증된 64종 6x6 베이스 패턴
export const UNOS_RAW_PRESET_STRINGS = Object.freeze([
    '231230/312123/230301/013210/130321/202010', // #01
    '310310/021202/302120/131312/020131/302323', // #02
    '210201/023030/101323/232030/313212/130121', // #03
    '201230/120123/313232/031310/120103/213020', // #04
    '021203/130120/202312/131023/302310/213103', // #05
    '131301/213020/320302/013230/231021/312102', // #06
    '301213/030301/123210/012321/120232/032013', // #07
    '202012/321301/202130/023213/301321/013013', // #08
    '130312/202021/031302/210230/321021/130313', // #09
    '313102/230313/023232/310120/202301/121010', // #10
    '132020/210313/302121/213032/301310/120203', // #11
    '232121/120302/301231/212302/303030/130101', // #12
    '203201/032020/103232/321303/212131/131010', // #13
    '123101/230232/012301/320230/132323/010101', // #14
    '103201/010320/232031/021302/312031/123213', // #15
    '210212/031031/213202/101030/212303/323130', // #16
    '203201/020130/232023/010101/231213/313132', // #17
    '302131/231323/123012/230101/313020/020102', // #18
    '320130/131213/023021/301202/032131/210203', // #19
    '312013/030202/202021/313103/101321/323102', // #20
    '101323/020210/212323/301231/212303/101030', // #21
    '120132/313010/202131/010313/103232/232020', // #22
    '312121/101213/032302/213213/102020/030303', // #23
    '020301/313232/021321/132030/303121/021012', // #24
    '313131/201202/020130/301013/212120/323203', // #25
    '321323/132131/213020/301232/030101/102020', // #26
    '021323/303102/010210/301021/012132/323213', // #27
    '101301/320123/012301/303230/212021/321302', // #28
    '021202/102313/013020/202131/131203/313032', // #29
    '231232/313120/231013/012102/231020/010303', // #30
    '213032/132301/203230/012013/120231/031012', // #31
    '130121/321303/230121/302312/123020/030102', // #32
    '101231/210120/132031/013123/302032/020323', // #33
    '301213/123031/231202/010121/323013/030202', // #34
    '323010/030101/123210/312103/030212/212323', // #35
    '101210/032132/120320/031012/203231/130323', // #36
    '201310/323131/101302/210130/323202/032021', // #37
    '321320/130212/012021/321303/213030/302101', // #38
    '302032/231313/120131/201202/132120/010303', // #39
    '232313/010202/132313/310101/021013/203202', // #40
    '023102/301013/023231/201320/323101/212310', // #41
    '302020/010303/303131/010323/123212/212121', // #42
    '121230/012121/321302/103131/320302/032030', // #43
    '303010/232121/310313/021020/303132/212021', // #44
    '121320/210203/032320/303212/121301/013130', // #45
    '320102/232313/101202/030120/212303/130131', // #46
    '301201/020323/212010/031203/323120/131231', // #47
    '123023/301202/230121/312010/120103/313230', // #48
    '013213/201301/320230/013023/321230/210121', // #49
    '232103/323232/030101/123023/030101/101212', // #50
    '023213/132030/203213/020301/313212/120101', // #51
    '303120/121031/303202/230120/121301/302123', // #52
    '103123/021301/212020/023212/102303/313031', // #53
    '303231/130320/313032/201310/012121/120202', // #54
    '021013/103202/012031/320120/013232/321313', // #55
    '032031/101323/032012/103201/230323/101212', // #56
    '132012/321230/230101/021212/203131/030303', // #57
    '230103/102320/213202/031010/303123/131212', // #58
    '102310/310202/101320/010203/131321/323232', // #59
    '320101/012312/323231/231303/123010/010202', // #60
    '131012/323103/032320/101031/323120/202012', // #61
    '232020/101302/210210/103102/032313/313231', // #62
    '210230/301313/123102/031231/102320/230102', // #63
    '032120/301202/030131/321320/010132/121323' // #64
]);

// 4! = 24가지 색상 치환 순열 테이블
export const UNOS_COLOR_PERMUTATIONS = Object.freeze([
    [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
    [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
    [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
    [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0]
].map(p => Object.freeze(p)));

// 정사각형 8대 대칭 변환 (0~3: 0/90/180/270도 회전, 4~7: 좌우 반전 후 회전)
export const UNOS_SYMMETRY_COUNT = 8;

function parseCompactGrid(compactStr) {
    return compactStr.split('/').map(rowStr => rowStr.split('').map(ch => Number(ch)));
}

function transformCoord(r, c, symmetryIdx) {
    const N = UNOS_BOARD_SIZE - 1; // 5
    const rot = symmetryIdx % 4;
    const flip = symmetryIdx >= 4;
    const fc = flip ? (N - c) : c;
    if (rot === 0) return [r, fc];
    if (rot === 1) return [fc, N - r];
    if (rot === 2) return [N - r, N - fc];
    return [N - fc, r];
}

/**
 * 베이스 프리셋(0..63), 대칭 변환(0..7), 색상 치환(0..23)으로 O(1) 6x6 색상 보드 생성
 */
export function buildUnosBoardFromVariant(presetIndex = 0, symmetryIndex = 0, permutationIndex = 0) {
    const pIdx = ((presetIndex % UNOS_RAW_PRESET_STRINGS.length) + UNOS_RAW_PRESET_STRINGS.length) % UNOS_RAW_PRESET_STRINGS.length;
    const sIdx = ((symmetryIndex % UNOS_SYMMETRY_COUNT) + UNOS_SYMMETRY_COUNT) % UNOS_SYMMETRY_COUNT;
    const perm = UNOS_COLOR_PERMUTATIONS[((permutationIndex % UNOS_COLOR_PERMUTATIONS.length) + UNOS_COLOR_PERMUTATIONS.length) % UNOS_COLOR_PERMUTATIONS.length];

    const baseNumeric = parseCompactGrid(UNOS_RAW_PRESET_STRINGS[pIdx]);
    const grid = Array.from({ length: UNOS_BOARD_SIZE }, () => Array(UNOS_BOARD_SIZE).fill('madness'));

    for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
        for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
            const [srcR, srcC] = transformCoord(r, c, sIdx);
            const rawColorIdx = baseNumeric[srcR][srcC];
            const mappedColorIdx = perm[rawColorIdx];
            grid[r][c] = UNOS_PERSONALITY_KEYS[mappedColorIdx];
        }
    }

    const signature = grid.map(row => row.map(k => k[0]).join('')).join('/');
    return {
        presetIndex: pIdx,
        symmetryIndex: sIdx,
        permutationIndex: permutationIndex % UNOS_COLOR_PERMUTATIONS.length,
        variantId: `P${pIdx}_S${sIdx}_C${permutationIndex % UNOS_COLOR_PERMUTATIONS.length}`,
        signature,
        grid
    };
}

// 64종 기본 프리셋을 즉시 열람 가능한 6x6 색상 배열로도 제공
export const UNOS_BOARD_PRESETS = Object.freeze(
    UNOS_RAW_PRESET_STRINGS.map((_, idx) => Object.freeze(buildUnosBoardFromVariant(idx, 0, 0).grid.map(row => Object.freeze(row))))
);

/**
 * 6x6 색상 보드가 4색 각 9칸 균등 분배 및 상하좌우 비인접 조건을 만족하는지 검증
 * @param {string[][]} grid
 * @returns {{ valid: boolean, counts: Record<string, number>, adjacencyViolations: number, reason: string | null }}
 */
export function validateUnosBoardGrid(grid) {
    if (!Array.isArray(grid) || grid.length !== UNOS_BOARD_SIZE) {
        return { valid: false, counts: {}, adjacencyViolations: 0, reason: 'INVALID_ROW_COUNT' };
    }

    const counts = {
        madness: 0,
        calm: 0,
        pure: 0,
        lively: 0
    };
    let adjacencyViolations = 0;

    for (let r = 0; r < UNOS_BOARD_SIZE; r++) {
        if (!Array.isArray(grid[r]) || grid[r].length !== UNOS_BOARD_SIZE) {
            return { valid: false, counts, adjacencyViolations, reason: 'INVALID_COL_COUNT' };
        }
        for (let c = 0; c < UNOS_BOARD_SIZE; c++) {
            const color = grid[r][c];
            if (!(color in counts)) {
                return { valid: false, counts, adjacencyViolations, reason: `UNKNOWN_COLOR:${color}` };
            }
            counts[color] += 1;

            if (r > 0 && grid[r - 1][c] === color) {
                adjacencyViolations += 1;
            }
            if (c > 0 && grid[r][c - 1] === color) {
                adjacencyViolations += 1;
            }
        }
    }

    for (const key of UNOS_PERSONALITY_KEYS) {
        if (counts[key] !== UNOS_CELLS_PER_COLOR) {
            return {
                valid: false,
                counts,
                adjacencyViolations,
                reason: `COLOR_COUNT_MISMATCH:${key}=${counts[key]}`
            };
        }
    }

    if (adjacencyViolations > 0) {
        return {
            valid: false,
            counts,
            adjacencyViolations,
            reason: `ORTHOGONAL_ADJACENCY:${adjacencyViolations}`
        };
    }

    return {
        valid: true,
        counts,
        adjacencyViolations: 0,
        reason: null
    };
}

/**
 * O(1) 랜덤 보드 프리셋/변형 선택기 (리버스 시 직전 보드 signature 제외 보장)
 * @param {{ excludeSignature?: string | null, excludePresetIndex?: number | null, rng?: () => number }} options
 */
export function pickRandomUnosBoardPreset(options = {}) {
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    const excludeSig = options.excludeSignature || null;
    const excludePresetIdx = Number.isInteger(options.excludePresetIndex) ? options.excludePresetIndex : null;

    const totalPresets = UNOS_RAW_PRESET_STRINGS.length;
    let pIdx = Math.floor(rng() * totalPresets);
    if (excludePresetIdx !== null && totalPresets > 1 && pIdx === excludePresetIdx) {
        pIdx = (pIdx + 1 + Math.floor(rng() * (totalPresets - 1))) % totalPresets;
    }
    const sIdx = Math.floor(rng() * UNOS_SYMMETRY_COUNT);
    const cIdx = Math.floor(rng() * UNOS_COLOR_PERMUTATIONS.length);

    let candidate = buildUnosBoardFromVariant(pIdx, sIdx, cIdx);
    if (excludeSig && candidate.signature === excludeSig) {
        const nextPIdx = (pIdx + 1) % totalPresets;
        const nextCIdx = (cIdx + 1) % UNOS_COLOR_PERMUTATIONS.length;
        candidate = buildUnosBoardFromVariant(nextPIdx, (sIdx + 1) % UNOS_SYMMETRY_COUNT, nextCIdx);
    }
    return candidate;
}
