import { projectIndia } from './india-map'

/**
 * Where an order's city sits on the India outline (lib/india-map.ts coordinates). Shopify gives a city name, not
 * coordinates, so this is a lookup of the cities D2C orders come from. An unknown city gets no dot; its order still lists.
 */
const LONLAT: Record<string, [number, number]> = {
  delhi: [77.209, 28.614], 'new delhi': [77.209, 28.614], mumbai: [72.878, 19.076], kolkata: [88.364, 22.573],
  bengaluru: [77.595, 12.972], bangalore: [77.595, 12.972], hyderabad: [78.487, 17.385], chennai: [80.271, 13.083],
  ahmedabad: [72.571, 23.023], lucknow: [80.946, 26.847], pune: [73.856, 18.52], jaipur: [75.787, 26.912], kochi: [76.267, 9.931],
  cochin: [76.267, 9.931], ernakulam: [76.299, 9.982], indore: [75.857, 22.719], surat: [72.831, 21.17], nagpur: [79.088, 21.146],
  chandigarh: [76.779, 30.733], mohali: [76.717, 30.704], panchkula: [76.86, 30.69], bhopal: [77.412, 23.259], patna: [85.138, 25.594],
  vadodara: [73.181, 22.307], baroda: [73.181, 22.307], ludhiana: [75.857, 30.901], agra: [78.008, 27.177], nashik: [73.79, 19.998],
  thane: [72.977, 19.218], 'navi mumbai': [73.029, 19.033], kalyan: [73.13, 19.24], gurugram: [77.026, 28.459], gurgaon: [77.026, 28.459],
  noida: [77.391, 28.535], 'greater noida': [77.504, 28.474], ghaziabad: [77.454, 28.669], faridabad: [77.317, 28.408], kanpur: [80.332, 26.449],
  varanasi: [82.974, 25.318], prayagraj: [81.846, 25.435], allahabad: [81.846, 25.435], meerut: [77.706, 28.984], visakhapatnam: [83.219, 17.687],
  vizag: [83.219, 17.687], coimbatore: [76.956, 11.017], madurai: [78.12, 9.925], tiruchirappalli: [78.704, 10.79], salem: [78.146, 11.664],
  mysuru: [76.639, 12.296], mysore: [76.639, 12.296], mangaluru: [74.856, 12.914], mangalore: [74.856, 12.914], hubli: [75.124, 15.365],
  thiruvananthapuram: [76.937, 8.524], trivandrum: [76.937, 8.524], kozhikode: [75.78, 11.259], calicut: [75.78, 11.259], thrissur: [76.214, 10.527],
  guwahati: [91.736, 26.145], bhubaneswar: [85.825, 20.296], cuttack: [85.879, 20.462], ranchi: [85.31, 23.344], jamshedpur: [86.203, 22.805],
  raipur: [81.63, 21.251], dehradun: [78.032, 30.316], amritsar: [74.872, 31.634], jalandhar: [75.576, 31.326], jodhpur: [73.025, 26.238],
  udaipur: [73.713, 24.585], kota: [75.864, 25.214], ajmer: [74.64, 26.45], rajkot: [70.802, 22.303], bhavnagar: [72.152, 21.765],
  goa: [73.828, 15.299], panaji: [73.828, 15.499], margao: [73.958, 15.273], vijayawada: [80.648, 16.506], guntur: [80.437, 16.307],
  warangal: [79.594, 17.968], aurangabad: [75.343, 19.876], solapur: [75.906, 17.659], kolhapur: [74.243, 16.705], jammu: [74.857, 32.726],
  srinagar: [74.797, 34.083], siliguri: [88.395, 26.727], gwalior: [78.182, 26.218], jabalpur: [79.932, 23.181], shimla: [77.173, 31.105],
  haridwar: [78.164, 29.946], howrah: [88.264, 22.596], durgapur: [87.321, 23.52], 'port blair': [92.726, 11.623], imphal: [93.938, 24.817],
  shillong: [91.883, 25.578], agartala: [91.287, 23.831], aizawl: [92.718, 23.727], gangtok: [88.612, 27.338], puducherry: [79.808, 11.941],
  pondicherry: [79.808, 11.941], vellore: [79.132, 12.917], tirupati: [79.419, 13.628], nellore: [79.986, 14.443], belagavi: [74.498, 15.849],
  belgaum: [74.498, 15.849], davanagere: [75.924, 14.464], bikaner: [73.312, 28.022], bareilly: [79.432, 28.367], aligarh: [78.088, 27.898],
  moradabad: [78.773, 28.838], gorakhpur: [83.373, 26.76], dhanbad: [86.43, 23.796], bokaro: [86.151, 23.669], bilaspur: [82.141, 22.08],
  ujjain: [75.785, 23.179], anand: [72.951, 22.556], gandhinagar: [72.636, 23.215], vapi: [72.904, 20.371], navsari: [72.952, 20.95],

  // Shopify's city field often holds the district its pincode resolves to, not the town. Placed at the district HQ.
  'south delhi': [77.209, 28.614], 'west delhi': [77.209, 28.614], 'south west delhi': [77.209, 28.614], 'north west delhi': [77.209, 28.614],
  'east delhi': [77.209, 28.614], 'north delhi': [77.209, 28.614], 'central delhi': [77.209, 28.614], 'north east delhi': [77.209, 28.614],
  shahdara: [77.209, 28.614], 'mumbai suburban': [72.878, 19.076], 'bengaluru urban': [77.595, 12.972], 'bangalore urban': [77.595, 12.972],
  'bangalore rural': [77.68, 13.2], 'bengaluru rural': [77.68, 13.2], 'k v rangareddy': [78.4, 17.3], rangareddy: [78.4, 17.3], 'ranga reddy': [78.4, 17.3],
  'medchal malkajgiri': [78.54, 17.45], 'gautam buddha nagar': [77.391, 28.535], 'kanpur nagar': [80.332, 26.449], 'kamrup metro': [91.736, 26.145],
  kamrup: [91.736, 26.145], 'east khasi hills': [91.883, 25.578], 'imphal west': [93.938, 24.817], 'imphal east': [93.938, 24.817],
  'south andaman': [92.726, 11.623], 'west tripura': [91.287, 23.831], 'dakshina kannada': [74.856, 12.914], 'chhatrapati sambhajinagar': [75.343, 19.876],
  'gandhi nagar': [72.636, 23.215], belgavi: [74.498, 15.849], davangere: [75.924, 14.464], 'north goa': [73.83, 15.55], mapusa: [73.81, 15.59],
  'south goa': [73.958, 15.273], krishna: [81.14, 16.19], 'west godavari': [81.1, 16.71], 'east godavari': [82.24, 16.99], rajahmundry: [81.8, 17.0],
  rajhmundry: [81.8, 17.0], gulbarga: [76.83, 17.33], kalaburagi: [76.83, 17.33], kanchipuram: [79.7, 12.83], 'papum pare': [93.62, 27.08],
  itanagar: [93.62, 27.08], malappuram: [76.07, 11.05], kohima: [94.11, 25.67], koraput: [82.71, 18.81], hoshiarpur: [75.91, 31.53],
  'north 24 parganas': [88.48, 22.72], 'south 24 parganas': [88.4, 22.3], sonitpur: [92.8, 26.63], tezpur: [92.8, 26.63], jhansi: [78.57, 25.45],
  khorda: [85.62, 20.18], khordha: [85.62, 20.18], dimapur: [93.73, 25.91], krishnagiri: [78.21, 12.52], palakkad: [76.65, 10.78],
  tirunelveli: [77.7, 8.71], dharwad: [75.0, 15.46], bardhaman: [87.86, 23.23], burdwan: [87.86, 23.23], erode: [77.72, 11.34],
  bellary: [76.92, 15.14], ballari: [76.92, 15.14], kachchh: [69.67, 23.25], kutch: [69.67, 23.25], rajnandgaon: [81.03, 21.1],
  raigarh: [83.4, 21.9], raigad: [72.87, 18.64], 'karim nagar': [79.13, 18.44], karimnagar: [79.13, 18.44], alappuzha: [76.34, 9.5],
  alleppey: [76.34, 9.5], balrampur: [82.19, 27.43], phagwara: [75.77, 31.22], tumkur: [77.1, 13.34], tumakuru: [77.1, 13.34],
  ramanathapuram: [78.83, 9.37], 'fatehgarh sahib': [76.39, 30.65], 'jaintia hills': [92.2, 25.45], 'west jaintia hills': [92.2, 25.45],
  rupnagar: [76.53, 30.97], jamnagar: [70.07, 22.47], kurnool: [78.04, 15.83], dindigul: [77.98, 10.36], 'west garo hills': [90.22, 25.51],
  chittoor: [79.1, 13.22], cachar: [92.8, 24.83], silchar: [92.8, 24.83], karnal: [76.99, 29.69], 'udham singh nagar': [79.4, 28.98],
  shivamogga: [75.57, 13.93], shimoga: [75.57, 13.93], saharanpur: [77.55, 29.97], 'west singhbhum': [85.8, 22.55], chickamagalur: [75.77, 13.32],
  chikkamagaluru: [75.77, 13.32], 'west champaran': [84.5, 26.8], virudhunagar: [77.96, 9.58], bijapur: [75.71, 16.83], vijayapura: [75.71, 16.83],
  hailakandi: [92.56, 24.68], nawanshahr: [76.12, 31.12], mandya: [76.9, 12.52], 'east midnapore': [87.92, 22.3], 'west midnapore': [87.32, 22.42],
  kottayam: [76.52, 9.59], saiha: [92.97, 22.49], dhamtari: [81.55, 20.71], udupi: [74.75, 13.34], dibrugarh: [94.91, 27.47],
  bagepalli: [77.79, 13.78], 'north cachar hills': [93.02, 25.17], 'dima hasao': [93.02, 25.17], siwan: [84.36, 26.22], ambala: [76.78, 30.38],
  bathinda: [74.95, 30.21], dahod: [74.25, 22.83], nagaon: [92.68, 26.35], 'uttara kannada': [74.13, 14.81], markapuram: [79.27, 15.73],
  raichur: [77.36, 16.2], barpeta: [91.0, 26.32], gaya: [85.0, 24.79], satara: [74.0, 17.68], pherzawl: [93.19, 24.26],
  sindhudurg: [73.7, 16.1], tiruvallur: [79.91, 13.14], sundergarh: [84.03, 22.12], baghpat: [77.22, 28.94], adilabad: [78.53, 19.66],
  shahdol: [81.36, 23.3], puruliya: [86.36, 23.33], purulia: [86.36, 23.33], gurdaspur: [75.4, 32.04], 'dibang valley': [95.88, 28.8],
  anini: [95.88, 28.8], bhadrak: [86.5, 21.06], ananthnag: [75.15, 33.73], anantnag: [75.15, 33.73], kolar: [78.13, 13.14],
  supaul: [86.6, 26.12], 'west sikkim': [88.26, 27.29], morbi: [70.84, 22.82], mon: [95.03, 26.73], thanjavur: [79.14, 10.79],
  dewas: [76.05, 22.97], nimbahera: [74.68, 24.62], 'east siang': [95.33, 28.07], kapurthala: [75.38, 31.38], ramanagar: [77.28, 12.72],
  ramanagara: [77.28, 12.72], 'dadra nagar haveli': [73.02, 20.27], silvassa: [73.02, 20.27], 'panch mahals': [73.61, 22.78], akola: [77.0, 20.71],
  panipat: [76.97, 29.39], chikkaballapur: [77.73, 13.43], kullu: [77.11, 31.96], muzaffarnagar: [77.71, 29.47], mahesana: [72.39, 23.6],
  mehsana: [72.39, 23.6], firozpur: [74.61, 30.93], mahasamund: [82.1, 21.11], bhojpur: [84.66, 25.56], 'cooch behar': [89.45, 26.32],
  firozabad: [78.4, 27.15], 'yamuna nagar': [77.29, 30.13], chittorgarh: [74.63, 24.88], basti: [82.73, 26.8], tuticorin: [78.14, 8.76],
  thoothukudi: [78.14, 8.76], kalimpong: [88.47, 27.06], darjiling: [88.26, 27.04], darjeeling: [88.26, 27.04], vidisha: [77.81, 23.53],
  kanyakumari: [77.43, 8.18], katihar: [87.58, 25.54], kopargaon: [74.48, 19.88], valsad: [72.93, 20.61], doda: [75.55, 33.15],
  rampur: [79.03, 28.81], pakur: [87.84, 24.64], nilgiris: [76.7, 11.41], bidar: [77.52, 17.91], tiruppur: [77.34, 11.11],
  kurukshetra: [76.85, 29.97], jharsuguda: [84.01, 21.86],
}

const STATES = /\s+(haryana|punjab|maharashtra|karnataka|kerala|gujarat|rajasthan|tamil nadu|uttar pradesh|west bengal|assam|bihar|odisha|telangana|andhra pradesh|madhya pradesh|goa|delhi)$/

/** "Mapusa, North Goa." → "mapusa"; "K.V.Rangareddy" → "k v rangareddy"; "Bijapur(KAR)" → "bijapur"; "Karnal Haryana" → "karnal". */
export function cityKey(city: string): string[] {
  const s = city.toLowerCase().replace(/\(.*?\)/g, ' ')
  const clean = (t: string) => t.replace(/&/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+(district|dist)$/, '').trim()
  const whole = clean(s)
  const first = clean(s.split(',')[0])
  return [...new Set([whole, first, whole.replace(STATES, '')])].filter(Boolean)
}

export function cityOnMap(city: string): { x: number; y: number } | null {
  for (const k of cityKey(city)) {
    const ll = LONLAT[k]
    if (ll) return projectIndia(ll[0], ll[1])
  }
  return null
}
