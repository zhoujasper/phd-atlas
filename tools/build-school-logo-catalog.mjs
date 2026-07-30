import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { DISCOVER_SCHOOL_ADAPTERS } from '../server/discover-school-adapters/catalog.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const CATALOG_DIR = fileURLToPath(new URL('../server/school-logo-catalog/', import.meta.url))
const ASSET_DIR = fileURLToPath(new URL('../server/school-logo-catalog/assets/', import.meta.url))
const CATALOG_PATH = fileURLToPath(new URL('../server/school-logo-catalog/catalog.json', import.meta.url))
const TARGET_COUNT = Math.max(201, Number.parseInt(process.argv[2] || '225', 10) || 225)
const OPENALEX_CANDIDATE_COUNT = Math.max(360, TARGET_COUNT + 100)
const FINALIZE_EXISTING = process.env.FINALIZE_EXISTING === '1'
const REQUEST_TIMEOUT_MS = 20_000
const WIKIDATA_LANGUAGES = Object.freeze([
  'en',
  'zh',
  'zh-hans',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'th',
  'vi',
])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const MANUAL_ALIASES = Object.freeze({
  'Massachusetts Institute of Technology': ['MIT', '麻省理工', '麻省理工学院', 'マサチューセッツ工科大学', '매사추세츠 공과대학교'],
  'University of Oxford': ['Oxford', 'Oxford University', '牛津大学', 'オックスフォード大学', '옥스퍼드 대학교'],
  'University of Cambridge': ['Cambridge', 'Cambridge University', '剑桥大学', '劍橋大學', 'ケンブリッジ大学', '케임브리지 대학교'],
  'Stanford University': ['Stanford', '斯坦福大学', '史丹福大学', 'スタンフォード大学', '스탠퍼드 대학교'],
  'Harvard University': ['Harvard', '哈佛大学', 'ハーバード大学', '하버드 대학교'],
  'University of Toronto': ['U of T', 'UofT', '多伦多大学', '多倫多大學', 'トロント大学', '토론토 대학교'],
  'University of Amsterdam': ['UvA', '阿姆斯特丹大学', 'アムステルダム大学', '암스테르담 대학교'],
  'Hong Kong University of Science and Technology': ['HKUST', '香港科技大学', '香港科技大學', '香港科学技術大学', '홍콩과기대'],
  'Tsinghua University': ['Tsinghua', '清华大学', '清華大學', '清華大学', '칭화 대학'],
  'Fudan University': ['Fudan', '复旦大学', '復旦大學', '復旦大学', '푸단 대학'],
  'Peking University': ['PKU', 'Beida', '北京大学', '北京大學', '北京大学校', '베이징 대학'],
  'ETH Zurich': ['ETH', 'ETH Zürich', '苏黎世联邦理工学院', 'チューリッヒ工科大学', '취리히 연방 공과대학교'],
  'École Polytechnique Fédérale de Lausanne': ['EPFL', '洛桑联邦理工学院', 'ローザンヌ工科大学', '로잔 연방 공과대학교'],
  'National University of Singapore': ['NUS', '新加坡国立大学', 'シンガポール国立大学', '싱가포르 국립대학교'],
  'Nanyang Technological University': ['NTU Singapore', 'NTU', '南洋理工大学', '南洋理工大學', '南洋理工大学校'],
  'New York University': ['NYU', '纽约大学', '紐約大學', 'ニューヨーク大学', '뉴욕 대학교'],
  'Georgia Institute of Technology': ['Georgia Tech', 'GT', '佐治亚理工学院', 'ジョージア工科大学', '조지아 공과대학교'],
  'University of California, Los Angeles': ['UCLA', 'University of California Los Angeles', '加州大学洛杉矶分校', 'カリフォルニア大学ロサンゼルス校'],
  'University of California, San Diego': ['UCSD', 'University of California San Diego', '加州大学圣迭戈分校', 'カリフォルニア大学サンディエゴ校'],
  'University of California, Davis': ['UC Davis', 'UCD', 'University of California Davis', '加州大学戴维斯分校'],
  'University of California, Irvine': ['UC Irvine', 'UCI', 'University of California Irvine', '加州大学欧文分校'],
  'University of California, Santa Barbara': ['UC Santa Barbara', 'UCSB', 'University of California Santa Barbara', '加州大学圣塔芭芭拉分校'],
  'The University of Edinburgh': ['University of Edinburgh', 'Edinburgh University', '爱丁堡大学', '愛丁堡大學', 'エディンバラ大学'],
  'University of Wisconsin-Madison': ['UW–Madison', 'UW-Madison', 'University of Wisconsin Madison', '威斯康星大学麦迪逊分校'],
  'Ludwig Maximilian University of Munich': ['LMU Munich', 'LMU München', 'University of Munich', '慕尼黑大学'],
  'Karlsruhe Institute of Technology': ['KIT', 'Karlsruher Institut für Technologie', '卡尔斯鲁厄理工学院'],
  'Leiden University': ['Universiteit Leiden', 'Leiden', '莱顿大学'],
  'University of Southampton': ['Southampton University', '南安普顿大学'],
  'RMIT University': ['RMIT', 'Royal Melbourne Institute of Technology', '皇家墨尔本理工大学'],
  'University of Nottingham': ['Nottingham University', '诺丁汉大学'],
  'University of Barcelona': ['Universitat de Barcelona', 'UB Barcelona', '巴塞罗那大学'],
  'The University of Tokyo': ['University of Tokyo', 'UTokyo', '东京大学', '東京大学', '도쿄 대학'],
  'Seoul National University': ['SNU', '首尔大学', '首爾大學', 'ソウル大学', '서울대학교'],
  'Carnegie Mellon University': ['CMU', 'Carnegie Mellon', '卡内基梅隆大学', '卡內基美隆大學', 'カーネギーメロン大学', '카네기 멜런 대학교'],
  'Columbia University': ['Columbia', '哥伦比亚大学', '哥倫比亞大學', 'コロンビア大学', '컬럼비아 대학교'],
  'University of Chicago': ['UChicago', 'Chicago University', '芝加哥大学', '芝加哥大學', 'シカゴ大学', '시카고 대학교'],
  'London School of Economics and Political Science': ['LSE', 'London School of Economics', '伦敦政治经济学院', '倫敦政治經濟學院', 'ロンドン・スクール・オブ・エコノミクス', '런던 정치경제대학교'],
  'University of St Andrews': ['St Andrews', 'St Andrews University', '圣安德鲁斯大学', '聖安德魯斯大學', 'セント・アンドルーズ大学', '세인트앤드루스 대학교'],
  'University of Melbourne': ['Melbourne University', 'UniMelb', '墨尔本大学', '墨爾本大學', 'メルボルン大学', '멜버른 대학교'],
  'University of Sydney': ['Sydney University', 'USyd', '悉尼大学', '雪梨大學', 'シドニー大学', '시드니 대학교'],
  'University of Queensland': ['UQ', 'Queensland University', '昆士兰大学', '昆士蘭大學', 'クイーンズランド大学', '퀸즐랜드 대학교'],
  'University of New South Wales': ['UNSW', 'UNSW Sydney', '新南威尔士大学', '新南威爾斯大學', 'ニューサウスウェールズ大学', '뉴사우스웨일스 대학교'],
  "King's College London": ['KCL', 'King’s College London', 'London Kings College', '伦敦国王学院', '倫敦國王學院', 'キングス・カレッジ・ロンドン', '킹스 칼리지 런던'],
  'University of Manchester': ['Manchester University', 'UoM', '曼彻斯特大学', '曼徹斯特大學', 'マンチェスター大学', '맨체스터 대학교'],
  'McGill University': ['McGill', '麦吉尔大学', '麥基爾大學', 'マギル大学', '맥길 대학교'],
  'Chalmers University of Technology': ['Chalmers', 'Chalmers tekniska högskola', '查尔姆斯理工大学', '查爾姆斯理工大學', 'チャルマース工科大学', '찰머스 공과대학교'],
  'Technion – Israel Institute of Technology': ['Technion', 'Israel Institute of Technology', 'הטכניון', '以色列理工学院', '以色列理工學院', 'イスラエル工科大学', '테크니온 – 이스라엘 공과대학교'],
  'Universität Ulm': ['Ulm University', 'University of Ulm', '乌尔姆大学', '烏爾姆大學', 'ウルム大学', '울름 대학교'],
})

const PINNED_RECORDS = Object.freeze([
  {
    name: 'University of Cambridge',
    website: 'https://www.cam.ac.uk/',
    countryCode: 'GB',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Coat_of_Arms_of_the_University_of_Cambridge.svg',
    assetLicense: 'CC BY-SA 3.0',
    assetAttribution: 'Massive hair',
  },
  {
    name: 'University of Toronto',
    website: 'https://www.utoronto.ca/',
    countryCode: 'CA',
    assetSourceUrl: 'https://en.wikipedia.org/wiki/File:Utoronto_coa.svg',
    assetLicense: 'Compact nominative identification of a protected university mark',
    assetAttribution: 'University of Toronto',
  },
  {
    name: 'Carnegie Mellon University',
    website: 'https://www.cmu.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fcmu.edu&sz=256',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'Carnegie Mellon University',
  },
  {
    name: 'Columbia University',
    website: 'https://www.columbia.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fcolumbia.edu&sz=256',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'Columbia University',
  },
  {
    name: 'University of Chicago',
    website: 'https://www.uchicago.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://www.uchicago.edu/dist/intranet/favicon.ico',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'University of Chicago',
  },
  {
    name: 'London School of Economics and Political Science',
    website: 'https://www.lse.ac.uk/',
    countryCode: 'GB',
    assetSourceUrl: 'https://www.lse.ac.uk/_mClaLQ_81f90be3-1b22-43ae-b4d7-64f31b59acc6/static/favicon/apple-touch-icon.png',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'London School of Economics and Political Science',
  },
  {
    name: 'University of St Andrews',
    website: 'https://www.st-andrews.ac.uk/',
    countryCode: 'GB',
    assetSourceUrl: 'https://www.st-andrews.ac.uk/apple-touch-icon.png',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'University of St Andrews',
  },
  {
    name: 'University of Melbourne',
    website: 'https://www.unimelb.edu.au/',
    countryCode: 'AU',
    assetSourceUrl: 'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Funimelb.edu.au&sz=256',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'University of Melbourne',
  },
  {
    name: 'University of Sydney',
    website: 'https://www.sydney.edu.au/',
    countryCode: 'AU',
    assetSourceUrl: 'https://www.sydney.edu.au/etc.clientlibs/corporate-commons/clientlibs/foundation/resources/corporate-frontend/assets/img/favicon/favicon-96x96.png',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'University of Sydney',
  },
  {
    name: 'University of Queensland',
    website: 'https://www.uq.edu.au/',
    countryCode: 'AU',
    assetSourceUrl: 'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fuq.edu.au&sz=256',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'University of Queensland',
  },
  {
    name: 'University of New South Wales',
    website: 'https://www.unsw.edu.au/',
    countryCode: 'AU',
    assetSourceUrl: 'https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Funsw.edu.au&sz=256',
    assetLicense: 'Official-domain identity icon',
    assetAttribution: 'University of New South Wales',
  },
  {
    name: "King's College London",
    website: 'https://www.kcl.ac.uk/',
    countryCode: 'GB',
    assetSourceUrl: "https://commons.wikimedia.org/wiki/File:Shield_of_King's_College_London.svg",
    assetLicense: 'CC BY-SA 4.0',
    assetAttribution: 'Wikimedia Commons contributors',
  },
  {
    name: 'University of Manchester',
    website: 'https://www.manchester.ac.uk/',
    countryCode: 'GB',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Shield_of_the_University_of_Manchester.svg',
    assetLicense: 'CC BY-SA 4.0',
    assetAttribution: 'Wikimedia Commons contributors',
  },
  {
    name: 'McGill University',
    website: 'https://www.mcgill.ca/',
    countryCode: 'CA',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Mcgill_university_coa.png',
    assetLicense: 'Public domain',
    assetAttribution: 'McGill University',
  },
  {
    name: 'National University of Singapore',
    website: 'https://nus.edu.sg/',
    countryCode: 'SG',
    assetSourceUrl: 'https://nus.edu.sg/images/default-source/identity-images/nus-vlogo-color.png',
    assetLicense: 'Official NUS vertical colour identity asset for nominative identification',
    assetAttribution: 'National University of Singapore',
  },
  {
    name: 'Tsinghua University',
    website: 'https://www.tsinghua.edu.cn/en/',
    countryCode: 'CN',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Tsinghua_University_Logo.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Tsinghua_University_Logo.svg/330px-Tsinghua_University_Logo.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'Tsinghua University',
  },
  {
    name: 'Fudan University',
    website: 'https://www.fudan.edu.cn/en/',
    countryCode: 'CN',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Fudan_University_Logo.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Fudan_University_Logo.svg/330px-Fudan_University_Logo.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'Fudan University; vector by Prcmise',
  },
  {
    name: 'New York University',
    website: 'https://www.nyu.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:New_York_University_Seal.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/New_York_University_Seal.svg/330px-New_York_University_Seal.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'New York University',
  },
  {
    name: 'Georgia Institute of Technology',
    website: 'https://www.gatech.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Georgia_Tech_logo_2021.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Georgia_Tech_logo_2021.svg/330px-Georgia_Tech_logo_2021.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'Georgia Institute of Technology',
  },
  {
    name: 'University of California, Los Angeles',
    website: 'https://www.ucla.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:University_of_California,_Los_Angeles_logo.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/University_of_California%2C_Los_Angeles_logo.svg/330px-University_of_California%2C_Los_Angeles_logo.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'UCLA',
  },
  {
    name: 'University of California, San Diego',
    website: 'https://ucsd.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:University_of_California,_San_Diego_logo.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/University_of_California%2C_San_Diego_logo.svg/330px-University_of_California%2C_San_Diego_logo.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'University of California, San Diego',
  },
  {
    name: 'University of California, Davis',
    website: 'https://www.ucdavis.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:The_University_of_California_Davis.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/The_University_of_California_Davis.svg/330px-The_University_of_California_Davis.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'University of California, Davis; vector by Casecrer',
  },
  {
    name: 'University of California, Irvine',
    website: 'https://uci.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:The_University_of_California_Irvine.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/The_University_of_California_Irvine.svg/330px-The_University_of_California_Irvine.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'University of California, Irvine; vector by Casecrer',
  },
  {
    name: 'University of California, Santa Barbara',
    website: 'https://www.ucsb.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:UC_Santa_Barbara_Seal.png',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/UC_Santa_Barbara_Seal.png/330px-UC_Santa_Barbara_Seal.png',
    assetLicense: 'Public domain',
    assetAttribution: 'University of California, Santa Barbara',
  },
  {
    name: 'The University of Edinburgh',
    website: 'https://www.ed.ac.uk/',
    countryCode: 'GB',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:University_of_Edinburgh_c%C3%ADmer.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/University_of_Edinburgh_c%C3%ADmer.svg/330px-University_of_Edinburgh_c%C3%ADmer.svg.png',
    assetLicense: 'CC BY 4.0',
    assetAttribution: 'Wikimedia Commons contributor',
  },
  {
    name: 'University of Wisconsin-Madison',
    website: 'https://www.wisc.edu/',
    countryCode: 'US',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Seal_of_the_University_of_Wisconsin.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Seal_of_the_University_of_Wisconsin.svg/330px-Seal_of_the_University_of_Wisconsin.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'University of Wisconsin-Madison',
  },
  {
    name: 'Ludwig Maximilian University of Munich',
    website: 'https://www.lmu.de/en/',
    countryCode: 'DE',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Sigillum_Universitatis_Ludovico-Maximilianeae.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/Sigillum_Universitatis_Ludovico-Maximilianeae.svg/330px-Sigillum_Universitatis_Ludovico-Maximilianeae.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'Ludwig Maximilian University of Munich',
  },
  {
    name: 'Karlsruhe Institute of Technology',
    website: 'https://www.kit.edu/english/',
    countryCode: 'DE',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Logo_KIT.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Logo_KIT.svg/330px-Logo_KIT.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'Karlsruhe Institute of Technology',
  },
  {
    name: 'Leiden University',
    website: 'https://www.universiteitleiden.nl/en',
    countryCode: 'NL',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Leiden_University_seal.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Leiden_University_seal.svg/330px-Leiden_University_seal.svg.png',
    assetLicense: 'CC BY-SA 3.0',
    assetAttribution: 'Leiden University',
  },
  {
    name: 'University of Southampton',
    website: 'https://www.southampton.ac.uk/',
    countryCode: 'GB',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Shield_of_the_University_of_Southampton.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Shield_of_the_University_of_Southampton.svg/330px-Shield_of_the_University_of_Southampton.svg.png',
    assetLicense: 'CC BY-SA 4.0',
    assetAttribution: 'Wikimedia Commons contributor',
  },
  {
    name: 'RMIT University',
    website: 'https://www.rmit.edu.au/',
    countryCode: 'AU',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Arms_of_the_Royal_Melbourne_Institute_of_Technology.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/72/Arms_of_the_Royal_Melbourne_Institute_of_Technology.svg/330px-Arms_of_the_Royal_Melbourne_Institute_of_Technology.svg.png',
    assetLicense: 'CC BY-SA 4.0',
    assetAttribution: 'GaryJetner',
  },
  {
    name: 'University of Nottingham',
    website: 'https://www.nottingham.ac.uk/',
    countryCode: 'GB',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Shield_of_the_University_of_Nottingham.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Shield_of_the_University_of_Nottingham.svg/330px-Shield_of_the_University_of_Nottingham.svg.png',
    assetLicense: 'CC BY-SA 4.0',
    assetAttribution: 'Wikimedia Commons contributor',
  },
  {
    name: 'University of Barcelona',
    website: 'https://www.ub.edu/web/portal/en/',
    countryCode: 'ES',
    assetSourceUrl: 'https://commons.wikimedia.org/wiki/File:Coat_of_Arms_of_the_University_of_Barcelona.svg',
    assetDownloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Coat_of_Arms_of_the_University_of_Barcelona.svg/330px-Coat_of_Arms_of_the_University_of_Barcelona.svg.png',
    assetLicense: 'Public domain',
    assetAttribution: 'Hstoops',
  },
  {
    name: 'Chalmers University of Technology',
    website: 'https://www.chalmers.se/',
    countryCode: 'SE',
    assetSourceUrl: 'https://www.chalmers.se/apple-touch-icon.png',
    assetLicense: 'Official-domain identity icon presented on the official profile-purple field with compact padding',
    assetAttribution: 'Chalmers University of Technology',
  },
  {
    name: 'Technion – Israel Institute of Technology',
    website: 'https://www.technion.ac.il/',
    countryCode: 'IL',
    assetSourceUrl: 'https://marketing.technion.ac.il/plugging-in/download-technion/',
    assetLicense: 'Official Technion brand asset cropped to the identity symbol for compact display',
    assetAttribution: 'Technion – Israel Institute of Technology',
  },
  {
    name: 'Universität Ulm',
    website: 'https://www.uni-ulm.de/',
    countryCode: 'DE',
    assetSourceUrl: 'https://wissenschaftsstadt.uni-ulm.de/mediawiki/index.php?title=Datei:Uni_Ulm_Logo_rund_schwarz_400x400.png',
    assetLicense: 'CC0 1.0',
    assetAttribution: 'Universität Ulm',
  },
])

function normalizeHost(value) {
  try {
    return new URL(String(value || '').replace(/^http:/u, 'https:'))
      .hostname
      .toLowerCase()
      .replace(/^www\./u, '')
      .replace(/\.$/u, '')
  } catch {
    return ''
  }
}

function normalizeWebsite(value) {
  try {
    const url = new URL(String(value || '').replace(/^http:/u, 'https:'))
    if (url.protocol !== 'https:' || url.username || url.password) return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function shortHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 10)
}

function slugFor(name) {
  const stem = normalizeName(name)
    .replace(/\s+/gu, '-')
    .replace(/[^a-z0-9-]/gu, '')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 56) || 'university'
  return `${stem}-${shortHash(name)}`
}

async function fetchWithDeadline(url, init = {}, attempts = 2, timeoutMs = REQUEST_TIMEOUT_MS) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          'user-agent': 'PhDAtlas-SchoolLogoCatalog/1.0 (+offline-identity-assets)',
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if ([429, 503].includes(response.status) && attempt + 1 < attempts) {
        const retryAfterSeconds = Number.parseFloat(response.headers.get('retry-after') || '')
        const retryDelayMs = Number.isFinite(retryAfterSeconds)
          ? Math.min(20_000, Math.max(750, retryAfterSeconds * 1_000))
          : Math.min(8_000, 1_250 * (attempt + 1))
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        continue
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return response
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function fetchJson(url) {
  return fetchWithDeadline(url, { headers: { accept: 'application/json' } }, 4)
    .then((response) => response.json())
}

async function fetchOpenAlexInstitutions(limit) {
  const institutions = []
  let cursor = '*'
  while (institutions.length < limit && cursor) {
    const url = new URL('https://api.openalex.org/institutions')
    url.searchParams.set('filter', 'type:education')
    url.searchParams.set('sort', 'cited_by_count:desc')
    url.searchParams.set('per-page', '200')
    url.searchParams.set('cursor', cursor)
    url.searchParams.set(
      'select',
      'id,display_name,display_name_alternatives,homepage_url,country_code,ids',
    )
    const payload = await fetchJson(url)
    institutions.push(...(payload.results || []))
    cursor = payload.meta?.next_cursor || ''
  }
  return institutions.slice(0, limit)
}

function existingCatalogInstitutions(catalog) {
  return (catalog?.entries || []).map((entry) => ({
    display_name: entry.name,
    display_name_alternatives: entry.aliases || [],
    homepage_url: entry.officialWebsite,
    country_code: entry.countryCode || '',
    ids: {},
  }))
}

function mergeInstitutionRows(primaryRows, fallbackRows) {
  const result = []
  const seenNames = new Set()
  for (const row of [...primaryRows, ...fallbackRows]) {
    const key = normalizeName(row?.display_name)
    if (!key || seenNames.has(key)) continue
    seenNames.add(key)
    result.push(row)
  }
  return result
}

function wikipediaTitle(value) {
  try {
    const url = new URL(String(value || ''))
    const marker = '/wiki/'
    const index = url.pathname.indexOf(marker)
    if (index < 0) return ''
    return decodeURIComponent(url.pathname.slice(index + marker.length)).replace(/_/gu, ' ')
  } catch {
    return ''
  }
}

async function resolveWikipediaWikidataIds(records) {
  const unresolved = records.filter((record) => !record.wikidataId && record.wikipediaTitle)
  for (let offset = 0; offset < unresolved.length; offset += 30) {
    const batch = unresolved.slice(offset, offset + 30)
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.searchParams.set('action', 'query')
    url.searchParams.set('format', 'json')
    url.searchParams.set('origin', '*')
    url.searchParams.set('prop', 'pageprops')
    url.searchParams.set('ppprop', 'wikibase_item')
    url.searchParams.set('redirects', '1')
    url.searchParams.set('titles', batch.map((record) => record.wikipediaTitle).join('|'))
    const payload = await fetchJson(url)
    const normalized = new Map((payload.query?.normalized || []).map((item) => [
      normalizeName(item.to),
      normalizeName(item.from),
    ]))
    const redirects = new Map((payload.query?.redirects || []).map((item) => [
      normalizeName(item.to),
      normalizeName(item.from),
    ]))
    for (const page of Object.values(payload.query?.pages || {})) {
      const pageName = normalizeName(page.title)
      const candidateNames = new Set([pageName])
      for (const [to, from] of normalized) if (to === pageName) candidateNames.add(from)
      for (const [to, from] of redirects) if (to === pageName) candidateNames.add(from)
      const record = batch.find((item) => candidateNames.has(normalizeName(item.wikipediaTitle)))
      if (record && page.pageprops?.wikibase_item) {
        record.wikidataId = page.pageprops.wikibase_item
      }
    }
  }
}

async function enrichAliasesFromWikidata(records) {
  await resolveWikipediaWikidataIds(records)
  const byId = new Map(records.filter((record) => record.wikidataId).map((record) => [
    record.wikidataId,
    record,
  ]))
  const ids = [...byId.keys()]
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50)
    const url = new URL('https://www.wikidata.org/w/api.php')
    url.searchParams.set('action', 'wbgetentities')
    url.searchParams.set('format', 'json')
    url.searchParams.set('origin', '*')
    url.searchParams.set('ids', batch.join('|'))
    url.searchParams.set('props', 'labels|aliases')
    url.searchParams.set('languages', WIKIDATA_LANGUAGES.join('|'))
    let payload
    try {
      payload = await fetchJson(url)
    } catch (error) {
      process.stderr.write(`Wikidata alias batch skipped: ${String(error?.message || error)}\n`)
      continue
    }
    for (const entity of Object.values(payload.entities || {})) {
      const record = byId.get(entity.id)
      if (!record) continue
      for (const language of WIKIDATA_LANGUAGES) {
        if (entity.labels?.[language]?.value) record.aliases.add(entity.labels[language].value)
        for (const alias of entity.aliases?.[language] || []) record.aliases.add(alias.value)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
}

function adapterHomepage(adapter) {
  const hosts = [...(adapter.allowedHosts || [])]
    .map((host) => String(host || '').trim().toLowerCase().replace(/^www\./u, ''))
    .filter(Boolean)
    .sort((left, right) => left.split('.').length - right.split('.').length || left.length - right.length)
  return hosts[0] ? `https://${hosts[0]}/` : ''
}

function candidateRecords(openAlexRows) {
  const openAlex = openAlexRows
    .map((row, rank) => {
      const website = normalizeWebsite(row.homepage_url)
      return {
        name: String(row.display_name || '').trim(),
        aliases: new Set([row.display_name, ...(row.display_name_alternatives || [])].filter(Boolean)),
        countryCode: String(row.country_code || '').toUpperCase(),
        website,
        host: normalizeHost(website),
        rank,
        wikidataId: String(row.ids?.wikidata || '').replace(/^.*\//u, ''),
        wikipediaTitle: wikipediaTitle(row.ids?.wikipedia),
      }
    })
    .filter((row) => row.name && row.host)

  const byName = new Map(openAlex.map((record) => [normalizeName(record.name), record]))
  const byHost = new Map(openAlex.map((record) => [record.host, record]))
  const records = []
  const seenNames = new Set()
  const recordByHost = new Map()

  for (const [index, pinned] of PINNED_RECORDS.entries()) {
    const key = normalizeName(pinned.name)
    const aliases = new Set([pinned.name, ...(MANUAL_ALIASES[pinned.name] || [])])
    records.push({
      ...pinned,
      aliases,
      host: normalizeHost(pinned.website),
      rank: -PINNED_RECORDS.length + index,
      catalogPriority: index - PINNED_RECORDS.length,
    })
    seenNames.add(key)
    recordByHost.set(normalizeHost(pinned.website), records.at(-1))
  }

  for (const adapter of DISCOVER_SCHOOL_ADAPTERS) {
    const adapterName = normalizeName(adapter.school)
    const adapterHosts = (adapter.allowedHosts || []).map((host) => String(host).replace(/^www\./u, ''))
    const match = byName.get(adapterName)
      || adapterHosts.map((host) => byHost.get(host)).find(Boolean)
      || openAlex.find((record) => adapterHosts.some((host) => (
        record.host === host || record.host.endsWith(`.${host}`) || host.endsWith(`.${record.host}`)
      )))
    const website = match?.website || adapterHomepage(adapter)
    if (!website || seenNames.has(adapterName)) continue
    const aliases = new Set([adapter.school, ...(match?.aliases || [])])
    for (const alias of MANUAL_ALIASES[adapter.school] || []) aliases.add(alias)
    const host = normalizeHost(website)
    const existing = recordByHost.get(host)
    if (existing) {
      for (const alias of aliases) existing.aliases.add(alias)
      seenNames.add(adapterName)
      continue
    }
    records.push({
      ...match,
      name: adapter.school,
      aliases,
      website,
      host,
      rank: match?.rank ?? Number.MAX_SAFE_INTEGER,
      catalogPriority: records.length,
    })
    seenNames.add(adapterName)
    recordByHost.set(host, records.at(-1))
  }

  for (const record of openAlex) {
    const key = normalizeName(record.name)
    if (seenNames.has(key)) continue
    const aliases = new Set(record.aliases)
    for (const alias of MANUAL_ALIASES[record.name] || []) aliases.add(alias)
    const existing = recordByHost.get(record.host)
    if (existing) {
      for (const alias of aliases) existing.aliases.add(alias)
      seenNames.add(key)
      continue
    }
    records.push({
      ...record,
      aliases,
      catalogPriority: DISCOVER_SCHOOL_ADAPTERS.length + record.rank,
    })
    seenNames.add(key)
    recordByHost.set(record.host, records.at(-1))
  }
  return records
}

function pngGeometry(bytes) {
  if (
    bytes.length < 24
    || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) return null
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (
    width < 64
    || height < 64
    || width > 1_024
    || height > 1_024
    || width * height > 1_048_576
  ) return null
  return { width, height }
}

function siteIconProviderUrls(website) {
  const page = new URL(website)
  const google = new URL('https://www.google.com/s2/favicons')
  google.searchParams.set('domain_url', `${page.protocol}//${page.hostname}`)
  google.searchParams.set('sz', '256')
  const unavatar = new URL(`https://unavatar.io/${page.hostname}`)
  unavatar.searchParams.set('fallback', 'false')
  unavatar.searchParams.set('size', '256')
  return [
    unavatar,
    google,
    new URL(`https://icons.duckduckgo.com/ip3/${page.hostname}.ico`),
  ]
}

async function downloadPng(url, attempts = 1) {
  const response = await fetchWithDeadline(url, { headers: { accept: 'image/png' } }, attempts, 8_000)
  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!contentType.includes('image/png') || bytes.length > 600_000 || !pngGeometry(bytes)) return null
  return bytes
}

async function downloadSiteIcon(website, rejectedHashes = new Set()) {
  const candidates = await Promise.all(siteIconProviderUrls(website).map(async (url) => {
    try {
      const bytes = await downloadPng(url)
      return bytes || null
    } catch {
      return null
    }
  }))
  for (const bytes of candidates) {
    if (!bytes) continue
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (!rejectedHashes.has(hash)) return bytes
  }
  // Runtime discovery still uses the official-site resolver when every
  // bounded catalog provider fails.
  return null
}

async function downloadRecordIcon(record, rejectedHashes = new Set()) {
  const directAssetUrl = record.assetDownloadUrl || record.assetSourceUrl
  if (directAssetUrl) {
    try {
      const bytes = await downloadPng(directAssetUrl, 3)
      if (bytes) {
        const hash = createHash('sha256').update(bytes).digest('hex')
        if (!rejectedHashes.has(hash)) return bytes
      }
    } catch {
      // Some provenance URLs are brand pages or non-PNG source files. Fall
      // through to the bounded official-domain identity providers.
    }
  }
  return downloadSiteIcon(record.website, rejectedHashes)
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

function cleanAliases(record) {
  const result = []
  const seen = new Set()
  for (const value of [record.name, ...record.aliases]) {
    const alias = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
    const key = normalizeName(alias)
    if (
      !key
      || key.length > 120
      || /https?:|www\./iu.test(alias)
      || seen.has(key)
    ) continue
    seen.add(key)
    result.push(alias)
  }
  return result.sort((left, right) => normalizeName(right).length - normalizeName(left).length)
}

async function main() {
  await mkdir(ASSET_DIR, { recursive: true })
  const existingCatalog = await readFile(CATALOG_PATH, 'utf8')
    .then((source) => JSON.parse(source))
    .catch(() => null)
  const fallbackRows = existingCatalogInstitutions(existingCatalog)
  let usedOpenAlex = false
  let openAlexRows = fallbackRows
  if (process.env.SKIP_OPENALEX !== '1') {
    try {
      const fetchedRows = await fetchOpenAlexInstitutions(OPENALEX_CANDIDATE_COUNT)
      openAlexRows = mergeInstitutionRows(fetchedRows, fallbackRows)
      usedOpenAlex = true
    } catch (error) {
      if (!fallbackRows.length) throw error
      process.stderr.write(`OpenAlex refresh skipped; continuing from the existing catalog: ${String(error?.message || error)}\n`)
    }
  }
  const candidates = candidateRecords(openAlexRows)
  const existingByName = new Map((existingCatalog?.entries || []).map((entry) => [
    normalizeName(entry.name),
    entry,
  ]))
  for (const record of candidates) {
    const existing = existingByName.get(normalizeName(record.name))
    for (const alias of existing?.aliases || []) record.aliases.add(alias)
  }
  if (process.env.SKIP_WIKIDATA !== '1') {
    const aliasCandidates = FINALIZE_EXISTING
      ? (await Promise.all(candidates.map(async (record) => {
          const existing = await readFile(
            new URL(`../server/school-logo-catalog/assets/${slugFor(record.name)}.png`, import.meta.url),
          ).catch(() => null)
          return existing && pngGeometry(existing) ? record : null
        }))).filter(Boolean)
      : candidates
    await enrichAliasesFromWikidata(aliasCandidates)
  }

  const genericIconHashes = new Set()
  for (const url of siteIconProviderUrls('https://phd-atlas-no-such-university.invalid/')) {
    try {
      const bytes = await downloadPng(url)
      if (bytes) genericIconHashes.add(createHash('sha256').update(bytes).digest('hex'))
    } catch {
      // A provider may correctly reject the deliberately invalid domain.
    }
  }

  const iconResults = []
  let usableIconCount = 0
  for (let offset = 0; offset < candidates.length && usableIconCount < TARGET_COUNT; offset += 16) {
    const batch = candidates.slice(offset, offset + 16)
    const results = await mapConcurrent(batch, 8, async (record, batchIndex) => {
      try {
        const expectedAsset = `${slugFor(record.name)}.png`
        let bytes
        try {
          const existing = await readFile(new URL(`../server/school-logo-catalog/assets/${expectedAsset}`, import.meta.url))
          if (pngGeometry(existing)) bytes = existing
        } catch {
          bytes = null
        }
        if (!bytes && !FINALIZE_EXISTING) {
          bytes = await downloadRecordIcon(record, genericIconHashes)
        }
        if (!bytes) return null
        const hash = createHash('sha256').update(bytes).digest('hex')
        if (genericIconHashes.has(hash)) return null
        if (!await readFile(new URL(`../server/school-logo-catalog/assets/${expectedAsset}`, import.meta.url)).catch(() => null)) {
          await writeFile(new URL(`../server/school-logo-catalog/assets/${expectedAsset}`, import.meta.url), bytes)
        }
        return { record, bytes, hash, index: offset + batchIndex }
      } catch {
        return null
      }
    })
    iconResults.push(...results)
    usableIconCount += results.filter(Boolean).length
  }

  const entries = []
  const assetByHash = new Map()
  for (const result of iconResults) {
    if (!result || entries.length >= TARGET_COUNT) continue
    let asset = assetByHash.get(result.hash)
    if (!asset) {
      asset = `${slugFor(result.record.name)}.png`
      await writeFile(new URL(`../server/school-logo-catalog/assets/${asset}`, import.meta.url), result.bytes)
      assetByHash.set(result.hash, asset)
    }
    entries.push({
      id: slugFor(result.record.name),
      name: result.record.name,
      aliases: cleanAliases(result.record),
      countryCode: result.record.countryCode || '',
      officialWebsite: result.record.website,
      sourceUrl: result.record.website,
      asset,
      candidateKind: 'builtin-site-icon-v1',
      ...(result.record.assetSourceUrl
        ? {
            assetSourceUrl: result.record.assetSourceUrl,
            ...(result.record.assetDownloadUrl
              ? { assetDownloadUrl: result.record.assetDownloadUrl }
              : {}),
            assetLicense: result.record.assetLicense,
            assetAttribution: result.record.assetAttribution,
          }
        : {}),
    })
  }

  if (entries.length < TARGET_COUNT) {
    throw new Error(`Only ${entries.length} usable university marks were collected; ${TARGET_COUNT} required.`)
  }
  if (assetByHash.size < 201) {
    throw new Error(`Only ${assetByHash.size} distinct university marks were collected; more than 200 required.`)
  }

  const catalog = {
    version: 'builtin-school-logo-v1',
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    assetCount: assetByHash.size,
    dataSources: [
      'PhD Atlas Discover school adapters',
      ...(usedOpenAlex
        ? ['OpenAlex institution metadata']
        : ['Existing PhD Atlas school logo catalog metadata']),
      ...(process.env.SKIP_WIKIDATA === '1' ? [] : ['Wikidata multilingual labels and aliases']),
      'Official-domain site icons cached through bounded identity providers',
      'Pinned institution marks with per-entry provenance',
    ],
    trademarkNotice: 'University names and marks remain the property of their respective institutions and are included only as compact identity references.',
    entries,
  }
  await writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')

  const totalBytes = (await Promise.all(
    [...assetByHash.values()].map((asset) => readFile(new URL(`../server/school-logo-catalog/assets/${asset}`, import.meta.url))),
  )).reduce((sum, bytes) => sum + bytes.length, 0)
  process.stdout.write(`${JSON.stringify({
    root: ROOT,
    catalogDir: CATALOG_DIR,
    entries: entries.length,
    assets: assetByHash.size,
    bytes: totalBytes,
  }, null, 2)}\n`)
}

await main()
