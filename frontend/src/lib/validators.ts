/**
 * Validaciones personalizadas de documentos de identidad ecuatorianos (Cédula y RUC).
 */

export function validateEcuadorianDocument(doc: string, documentType: 'cedula' | 'ruc'): boolean {
  if (!doc || !/^\d+$/.test(doc)) {
    return false;
  }

  const len = doc.length;
  if (documentType === 'cedula' && len !== 10) {
    return false;
  }
  if (documentType === 'ruc' && len !== 13) {
    return false;
  }

  // Validar código de provincia (primeros dos dígitos entre 01 y 24, o 30)
  const province = parseInt(doc.substring(0, 2), 10);
  if (!((province >= 1 && province <= 24) || province === 30)) {
    return false;
  }

  const thirdDigit = parseInt(doc.charAt(2), 10);

  if (documentType === 'cedula') {
    if (thirdDigit >= 6) {
      return false;
    }
    return validateModulo10(doc);
  } else {
    // RUC (13 dígitos)
    // El establecimiento (últimos tres dígitos) no puede ser 000
    if (doc.substring(10) === '000') {
      return false;
    }

    if (thirdDigit < 6) {
      // Persona natural: primeros 10 dígitos deben ser una cédula válida
      return validateModulo10(doc.substring(0, 10));
    } else if (thirdDigit === 9) {
      // Persona jurídica / Sociedad privada: módulo 11
      // Coeficientes: 4, 3, 2, 7, 6, 5, 4, 3, 2 (para los primeros 9 dígitos)
      const coefficients = [4, 3, 2, 7, 6, 5, 4, 3, 2];
      let total = 0;
      for (let i = 0; i < 9; i++) {
        total += parseInt(doc.charAt(i), 10) * coefficients[i];
      }
      const remainder = total % 11;
      const checkDigit = parseInt(doc.charAt(9), 10);

      let expectedDigit = remainder === 0 ? 0 : 11 - remainder;
      if (expectedDigit === 10) {
        expectedDigit = 0;
      }

      return expectedDigit === checkDigit;
    } else if (thirdDigit === 6) {
      // Entidad pública: módulo 11
      // Coeficientes: 3, 2, 7, 6, 5, 4, 3, 2 (para los primeros 8 dígitos)
      if (doc.substring(9) === '0000') {
        return false;
      }
      const coefficients = [3, 2, 7, 6, 5, 4, 3, 2];
      let total = 0;
      for (let i = 0; i < 8; i++) {
        total += parseInt(doc.charAt(i), 10) * coefficients[i];
      }
      const remainder = total % 11;
      const checkDigit = parseInt(doc.charAt(8), 10);

      let expectedDigit = remainder === 0 ? 0 : 11 - remainder;
      if (expectedDigit === 10) {
        expectedDigit = 0;
      }

      return expectedDigit === checkDigit;
    }
  }

  return false;
}

function validateModulo10(cedula: string): boolean {
  // Algoritmo de Luhn / Módulo 10 con coeficientes 2, 1, 2, 1, 2, 1, 2, 1, 2
  const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let total = 0;
  for (let i = 0; i < 9; i++) {
    let val = parseInt(cedula.charAt(i), 10) * coefficients[i];
    if (val >= 10) {
      val -= 9;
    }
    total += val;
  }

  const checkDigit = parseInt(cedula.charAt(9), 10);
  const remainder = total % 10;
  const expectedDigit = remainder === 0 ? 0 : 10 - remainder;

  return expectedDigit === checkDigit;
}
