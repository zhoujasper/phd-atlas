/**
 * A curated, auditable starting set for Discover's live web research.
 *
 * These are university-owned HTTPS origins rather than search-engine results or
 * user-supplied URLs. Keeping the crawl boundary explicit prevents arbitrary
 * server-side requests while still giving the researcher broad coverage. The
 * crawler only follows HTTPS links on the declared university domain and
 * honours robots.txt independently for every subdomain it reaches.
 */
import {
  DISCOVER_SCHOOL_ADAPTERS,
  discoverSchoolAdapterFor,
} from './discover-school-adapters/catalog.js'
import { validateSchoolAdapterCoverage } from './discover-school-adapters/adapter-validator.js'

const SOURCE_ROWS = `
US|Massachusetts Institute of Technology|https://www.mit.edu/
US|Stanford University|https://www.stanford.edu/
US|Carnegie Mellon University|https://www.cmu.edu/
US|University of California, Berkeley|https://www.berkeley.edu/
US|Cornell University|https://www.cornell.edu/
US|University of Illinois Urbana-Champaign|https://illinois.edu/
US|Georgia Institute of Technology|https://www.gatech.edu/
US|University of Washington|https://www.washington.edu/
US|Princeton University|https://www.princeton.edu/
US|Harvard University|https://www.harvard.edu/
US|California Institute of Technology|https://www.caltech.edu/
US|University of California, Los Angeles|https://www.ucla.edu/
US|University of California, San Diego|https://ucsd.edu/
US|University of Michigan|https://umich.edu/
US|The University of Texas at Austin|https://www.utexas.edu/
US|Columbia University|https://www.columbia.edu/
US|New York University|https://www.nyu.edu/
US|University of Pennsylvania|https://www.upenn.edu/
US|Yale University|https://www.yale.edu/
US|Duke University|https://duke.edu/
US|Northwestern University|https://www.northwestern.edu/
US|Johns Hopkins University|https://www.jhu.edu/
US|University of Maryland, College Park|https://www.umd.edu/
US|Purdue University|https://www.purdue.edu/
US|University of Wisconsin-Madison|https://www.wisc.edu/
US|University of Massachusetts Amherst|https://www.umass.edu/
US|University of Southern California|https://www.usc.edu/
US|University of California, Davis|https://www.ucdavis.edu/
US|University of California, Irvine|https://www.uci.edu/
US|University of California, Santa Barbara|https://www.ucsb.edu/
US|University of Minnesota|https://twin-cities.umn.edu/
US|The Ohio State University|https://www.osu.edu/
US|The Pennsylvania State University|https://www.psu.edu/
US|Virginia Tech|https://www.vt.edu/
US|Northeastern University|https://www.northeastern.edu/
US|Rice University|https://www.rice.edu/
US|Brown University|https://www.brown.edu/
US|Dartmouth College|https://home.dartmouth.edu/
US|The University of Chicago|https://www.uchicago.edu/
US|University of Pittsburgh|https://www.pitt.edu/
US|Rutgers University|https://www.rutgers.edu/
US|Stony Brook University|https://www.stonybrook.edu/
US|Arizona State University|https://www.asu.edu/
US|Texas A&M University|https://www.tamu.edu/
US|University of North Carolina at Chapel Hill|https://www.unc.edu/
US|University of Colorado Boulder|https://www.colorado.edu/
UK|University of Oxford|https://www.ox.ac.uk/
UK|University of Cambridge|https://www.cam.ac.uk/
UK|Imperial College London|https://www.imperial.ac.uk/
UK|University College London|https://www.ucl.ac.uk/
UK|The University of Edinburgh|https://www.ed.ac.uk/
UK|The University of Manchester|https://www.manchester.ac.uk/
UK|University of Bristol|https://www.bristol.ac.uk/
UK|University of Warwick|https://warwick.ac.uk/
UK|King's College London|https://www.kcl.ac.uk/
UK|University of Glasgow|https://www.gla.ac.uk/
UK|University of Birmingham|https://www.birmingham.ac.uk/
UK|The University of Sheffield|https://www.sheffield.ac.uk/
UK|University of Southampton|https://www.southampton.ac.uk/
UK|University of Nottingham|https://www.nottingham.ac.uk/
UK|University of Leeds|https://www.leeds.ac.uk/
UK|Durham University|https://www.durham.ac.uk/
UK|Queen Mary University of London|https://www.qmul.ac.uk/
UK|Lancaster University|https://www.lancaster.ac.uk/
UK|University of York|https://www.york.ac.uk/
UK|University of Exeter|https://www.exeter.ac.uk/
UK|Cardiff University|https://www.cardiff.ac.uk/
UK|University of Liverpool|https://www.liverpool.ac.uk/
EU|ETH Zurich|https://ethz.ch/
EU|EPFL|https://www.epfl.ch/
EU|Technical University of Munich|https://www.tum.de/
EU|Ludwig Maximilian University of Munich|https://www.lmu.de/
EU|Technical University of Berlin|https://www.tu.berlin/
EU|Karlsruhe Institute of Technology|https://www.kit.edu/
EU|Heidelberg University|https://www.uni-heidelberg.de/
EU|Delft University of Technology|https://www.tudelft.nl/
EU|University of Amsterdam|https://www.uva.nl/
EU|Leiden University|https://www.universiteitleiden.nl/
EU|Eindhoven University of Technology|https://www.tue.nl/
EU|Utrecht University|https://www.uu.nl/
EU|RWTH Aachen University|https://www.rwth-aachen.de/
EU|KU Leuven|https://www.kuleuven.be/
EU|Ghent University|https://www.ugent.be/
EU|Paris-Saclay University|https://www.universite-paris-saclay.fr/
EU|Institut Polytechnique de Paris|https://www.ip-paris.fr/
EU|Sorbonne University|https://www.sorbonne-universite.fr/
EU|University Grenoble Alpes|https://www.univ-grenoble-alpes.fr/
EU|Ecole normale superieure|https://www.ens.psl.eu/
EU|KTH Royal Institute of Technology|https://www.kth.se/
EU|Chalmers University of Technology|https://www.chalmers.se/
EU|Lund University|https://www.lunduniversity.lu.se/
EU|Uppsala University|https://www.uu.se/
EU|Aalto University|https://www.aalto.fi/
EU|University of Helsinki|https://www.helsinki.fi/
EU|University of Copenhagen|https://www.ku.dk/
EU|Aarhus University|https://www.au.dk/
EU|Technical University of Denmark|https://www.dtu.dk/
EU|TU Wien|https://www.tuwien.at/
EU|University of Vienna|https://www.univie.ac.at/
EU|Politecnico di Milano|https://www.polimi.it/
EU|University of Bologna|https://www.unibo.it/
EU|Sapienza University of Rome|https://www.uniroma1.it/
EU|University of Barcelona|https://web.ub.edu/
EU|Autonomous University of Madrid|https://www.uam.es/
CA|University of Toronto|https://www.utoronto.ca/
CA|University of British Columbia|https://www.ubc.ca/
CA|McGill University|https://www.mcgill.ca/
CA|University of Waterloo|https://uwaterloo.ca/
CA|University of Alberta|https://www.ualberta.ca/
CA|Universite de Montreal|https://www.umontreal.ca/
CA|McMaster University|https://www.mcmaster.ca/
CA|Queen's University|https://www.queensu.ca/
CA|Western University|https://www.uwo.ca/
CA|Simon Fraser University|https://www.sfu.ca/
CA|University of Calgary|https://www.ucalgary.ca/
SG|National University of Singapore|https://nus.edu.sg/
SG|Nanyang Technological University|https://www.ntu.edu.sg/
SG|Singapore Management University|https://www.smu.edu.sg/
SG|Singapore University of Technology and Design|https://www.sutd.edu.sg/
CN|Tsinghua University|https://www.tsinghua.edu.cn/
CN|Peking University|https://www.pku.edu.cn/
CN|Shanghai Jiao Tong University|https://www.sjtu.edu.cn/
CN|Zhejiang University|https://www.zju.edu.cn/
CN|Fudan University|https://www.fudan.edu.cn/
CN|University of Science and Technology of China|https://www.ustc.edu.cn/
CN|Nanjing University|https://www.nju.edu.cn/
HK|The University of Hong Kong|https://www.hku.hk/
HK|The Chinese University of Hong Kong|https://www.cuhk.edu.hk/
HK|Hong Kong University of Science and Technology|https://hkust.edu.hk/
HK|City University of Hong Kong|https://www.cityu.edu.hk/
CN|Tongji University|https://www.tongji.edu.cn/
CN|Wuhan University|https://www.whu.edu.cn/
CN|Harbin Institute of Technology|https://www.hit.edu.cn/
AU|Australian National University|https://www.anu.edu.au/
AU|The University of Melbourne|https://www.unimelb.edu.au/
AU|The University of Sydney|https://www.sydney.edu.au/
AU|UNSW Sydney|https://www.unsw.edu.au/
AU|Monash University|https://www.monash.edu/
AU|The University of Queensland|https://www.uq.edu.au/
AU|The University of Adelaide|https://www.adelaide.edu.au/
AU|University of Technology Sydney|https://www.uts.edu.au/
AU|RMIT University|https://www.rmit.edu.au/
AU|The University of Western Australia|https://www.uwa.edu.au/
AU|Macquarie University|https://www.mq.edu.au/
AU|Deakin University|https://www.deakin.edu.au/`

export const DISCOVER_SOURCE_REGISTRY = SOURCE_ROWS.trim().split('\n').map((row) => {
  const [region, school, url] = row.split('|')
  const adapter = discoverSchoolAdapterFor(school)
  if (!adapter) throw new Error(`Discover school adapter missing for ${school}`)
  if (adapter.region !== region) throw new Error(`Discover school adapter region mismatch for ${school}`)
  return Object.freeze({
    region,
    school,
    url,
    allowedHosts: adapter.allowedHosts,
    seeds: adapter.seeds,
    pathHints: adapter.pathHints,
    adapterVerifiedAt: adapter.verifiedAt,
  })
})

export const DISCOVER_SCHOOL_ADAPTER_COVERAGE = Object.freeze(
  validateSchoolAdapterCoverage(DISCOVER_SCHOOL_ADAPTERS, DISCOVER_SOURCE_REGISTRY, { minimumSchools: 100 }),
)

if (!DISCOVER_SCHOOL_ADAPTER_COVERAGE.passed) {
  throw new Error(`Discover school adapter coverage gate failed: ${DISCOVER_SCHOOL_ADAPTER_COVERAGE.errors.join('; ')}`)
}

export function listDiscoverResearchSources(regions = []) {
  const wanted = new Set((regions || []).map((region) => String(region).trim()).filter(Boolean))
  return DISCOVER_SOURCE_REGISTRY.filter((source) => wanted.size === 0 || wanted.has(source.region))
}

function sourceMatchScore(source, seeds) {
  const haystack = `${source.school} ${source.region}`.toLowerCase()
  return (seeds || []).reduce((score, seed) => {
    const terms = String(seed || '').toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 2)
    return score + terms.filter((term) => haystack.includes(term)).length
  }, 0)
}

/** Put explicit/current-application seeds first, then round-robin regions so a
 * bounded crawl remains broad instead of spending its whole budget in the US. */
export function prioritizeDiscoverResearchSources(sources, seeds = [], limit = 40) {
  const rows = [...(sources || [])]
  const scored = rows
    .map((source) => ({ source, score: sourceMatchScore(source, seeds) }))
    .sort((left, right) => right.score - left.score || left.source.school.localeCompare(right.source.school))
  const chosen = []
  const seen = new Set()
  for (const item of scored.filter((item) => item.score > 0)) {
    chosen.push(item.source)
    seen.add(item.source.url)
    if (chosen.length >= limit) return chosen
  }
  const buckets = new Map()
  for (const source of rows.filter((item) => !seen.has(item.url))) {
    const bucket = buckets.get(source.region) || []
    bucket.push(source)
    buckets.set(source.region, bucket)
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => (
      (Number(right.discoveryScore) || 0) - (Number(left.discoveryScore) || 0)
      || left.school.localeCompare(right.school)
    ))
  }
  while (chosen.length < limit && [...buckets.values()].some((bucket) => bucket.length)) {
    for (const bucket of buckets.values()) {
      const source = bucket.shift()
      if (source) chosen.push(source)
      if (chosen.length >= limit) break
    }
  }
  return chosen
}
