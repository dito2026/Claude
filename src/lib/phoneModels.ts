// Modelos comerciales de celulares más vendidos en Colombia (lista base para sugerencias).
// No crea productos: solo aparecen como sugerencias al escribir marca y modelo.
// Los modelos que se registren en la app se suman solos a esta lista.

const A = (prefix: string, items: string[]) => items.map((m) => `${prefix}${m}`);

export const COMMERCIAL_MODELS: Record<string, string[]> = {
  Samsung: [
    ...A('Galaxy A', ['03', '03s', '04', '04e', '04s', '05', '05s', '06', '07', '10', '10s', '11', '12', '13', '14', '14 5G', '15', '15 5G', '16', '16 5G', '17',
      '20', '20s', '21s', '22', '23', '24', '25', '26', '30', '30s', '31', '32', '33', '34', '35', '36', '50', '51', '52', '53', '54', '55', '56', '70', '71', '72', '73']),
    ...A('Galaxy M', ['12', '14', '15', '23', '33', '34', '54']),
    ...A('Galaxy S', ['20', '20 FE', '20 Ultra', '21', '21 FE', '21 Ultra', '22', '22 Plus', '22 Ultra', '23', '23 FE', '23 Plus', '23 Ultra',
      '24', '24 FE', '24 Plus', '24 Ultra', '25', '25 Edge', '25 FE', '25 Plus', '25 Ultra']),
    ...A('Galaxy Note ', ['10', '10 Plus', '20', '20 Ultra']),
    ...A('Galaxy Z ', ['Flip 4', 'Flip 5', 'Flip 6', 'Flip 7', 'Fold 4', 'Fold 5', 'Fold 6', 'Fold 7']),
  ],
  Apple: [
    ...A('iPhone ', ['7', '7 Plus', '8', '8 Plus', 'X', 'XR', 'XS', 'XS Max', '11', '11 Pro', '11 Pro Max', 'SE (2020)', 'SE (2022)',
      '12', '12 mini', '12 Pro', '12 Pro Max', '13', '13 mini', '13 Pro', '13 Pro Max', '14', '14 Plus', '14 Pro', '14 Pro Max',
      '15', '15 Plus', '15 Pro', '15 Pro Max', '16', '16 Plus', '16 Pro', '16 Pro Max', '16e', '17', '17 Pro', '17 Pro Max', 'Air']),
  ],
  Xiaomi: [
    ...A('Xiaomi ', ['12', '12T', '13', '13T', '13T Pro', '14', '14T', '14T Pro', '15', '15T', '15T Pro']),
    ...A('Poco ', ['X5', 'X5 Pro', 'X6', 'X6 Pro', 'X7', 'X7 Pro', 'F5', 'F6', 'M5', 'M6', 'M6 Pro', 'C65', 'C75']),
  ],
  Redmi: [
    '9', '9A', '9C', '9T', '10', '10A', '10C', '12', '12C', '13', '13C', '14C', '15', '15C', 'A1', 'A2', 'A3', 'A5',
    ...A('Note ', ['8', '9', '9S', '9 Pro', '10', '10S', '10 Pro', '11', '11S', '11 Pro', '12', '12S', '12 Pro', '13', '13 Pro', '13 Pro+', '14', '14 Pro', '14 Pro+']),
  ],
  Motorola: [
    ...A('Moto E', ['7', '13', '14', '15', '20', '22', '32', '40']),
    ...A('Moto G', ['04', '04s', '05', '8', '9 Play', '10', '15', '20', '22', '23', '24', '24 Power', '30', '31', '32', '34', '35', '41', '42', '45', '51', '52', '53', '54', '55', '60', '71', '72', '73', '75', '84', '85']),
    ...A('Edge ', ['30', '40', '40 Neo', '50', '50 Fusion', '50 Pro', '60']),
    'Razr 40', 'Razr 50',
  ],
  Honor: ['X6', 'X6a', 'X6b', 'X7', 'X7a', 'X7b', 'X7c', 'X8', 'X8a', 'X8b', 'X8c', 'X9a', 'X9b', '90', '200', 'Magic5 Lite', 'Magic6 Lite', 'Magic6 Pro', 'Magic7 Lite'],
  Huawei: ['Y6p', 'Y7a', 'Y9a', 'Y9 Prime 2019', 'P30 Lite', 'P40 Lite', 'Nova 9', 'Nova 10', 'Nova 11', 'Nova 12', 'Nova Y61', 'Nova Y70', 'Nova Y71', 'Nova Y72', 'Nova Y90'],
  Oppo: ['A15', 'A16', 'A17', 'A18', 'A38', 'A40', 'A54', 'A57', 'A58', 'A60', 'A78', 'A79', 'Reno 8', 'Reno 10', 'Reno 11', 'Reno 12'],
  Vivo: ['Y03', 'Y11', 'Y12', 'Y15s', 'Y16', 'Y17s', 'Y18', 'Y21', 'Y22', 'Y27', 'Y28', 'Y33s', 'Y35', 'Y36', 'V25', 'V27', 'V29', 'V30', 'V40'],
  Realme: ['C11', 'C21', 'C25', 'C30', 'C33', 'C35', 'C51', 'C53', 'C55', 'C61', 'C63', 'C65', 'C67', 'Note 50', '10', '11', '11 Pro', '12', '12 Pro'],
  Tecno: ['Spark 10', 'Spark 20', 'Spark 20 Pro', 'Spark 30', 'Camon 20', 'Camon 30', 'Pova 5', 'Pova 6', 'Pop 8'],
  Infinix: ['Hot 30', 'Hot 40', 'Hot 40i', 'Hot 50', 'Smart 7', 'Smart 8', 'Note 30', 'Note 40', 'Note 40 Pro'],
  ZTE: ['Blade A31', 'Blade A51', 'Blade A52', 'Blade A53', 'Blade A54', 'Blade A71', 'Blade A72', 'Blade V40', 'Blade V50'],
  Nokia: ['C2', 'C12', 'C21', 'C22', 'G10', 'G20', 'G21', 'G22'],
  Google: ['Pixel 6', 'Pixel 6a', 'Pixel 7', 'Pixel 7a', 'Pixel 7 Pro', 'Pixel 8', 'Pixel 8a', 'Pixel 8 Pro', 'Pixel 9', 'Pixel 9 Pro'],
  OnePlus: ['Nord CE 3', 'Nord N30', '11', '12'],
};

/** Pares (marca, modelo) del catálogo comercial, para sumarlos a las sugerencias. */
export const commercialPairs = () =>
  Object.entries(COMMERCIAL_MODELS).flatMap(([brand, models]) => models.map((model) => ({ brand, model })));
