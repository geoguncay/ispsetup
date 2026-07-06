"""
Validaciones personalizadas para la plataforma (cédula ecuatoriana, etc.).
"""

def validate_ecuadorian_cedula(cedula: str) -> bool:
    """
    Valida una cédula ecuatoriana (10 dígitos) o un RUC (13 dígitos) utilizando los algoritmos oficiales.
    """
    if not cedula or not cedula.isdigit():
        return False

    length = len(cedula)
    if length not in (10, 13):
        return False

    # Validar código de provincia (primeros dos dígitos entre 01 y 24, o 30)
    province = int(cedula[:2])
    if not (1 <= province <= 24 or province == 30):
        return False

    third_digit = int(cedula[2])

    if length == 10:
        # El tercer dígito debe ser menor a 6 para personas naturales en cédula
        if third_digit >= 6:
            return False
        return _validate_modulo10_cedula(cedula)
    else:
        # RUC (13 dígitos)
        # El establecimiento (últimos dígitos) no puede ser 000
        if cedula[10:] == "000":
            return False

        if third_digit < 6:
            # Persona natural: los primeros 10 dígitos deben ser una cédula válida
            return _validate_modulo10_cedula(cedula[:10])
        elif third_digit == 9:
            # Persona jurídica / Sociedad privada: módulo 11
            # Coeficientes: 4, 3, 2, 7, 6, 5, 4, 3, 2
            coefficients = [4, 3, 2, 7, 6, 5, 4, 3, 2]
            total = sum(int(cedula[i]) * coefficients[i] for i in range(9))
            remainder = total % 11
            check_digit = int(cedula[9])

            expected_digit = 0 if remainder == 0 else 11 - remainder
            if expected_digit == 10:
                expected_digit = 0

            return expected_digit == check_digit
        elif third_digit == 6:
            # Entidad pública: módulo 11
            # Coeficientes: 3, 2, 7, 6, 5, 4, 3, 2
            if cedula[9:] == "0000":
                return False
            coefficients = [3, 2, 7, 6, 5, 4, 3, 2]
            total = sum(int(cedula[i]) * coefficients[i] for i in range(8))
            remainder = total % 11
            check_digit = int(cedula[8])

            expected_digit = 0 if remainder == 0 else 11 - remainder
            if expected_digit == 10:
                expected_digit = 0

            return expected_digit == check_digit

    return False


def _validate_modulo10_cedula(cedula: str) -> bool:
    # Algoritmo de Luhn / Módulo 10 con coeficientes 2, 1, 2, 1, 2, 1, 2, 1, 2
    coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2]
    total = 0
    for i in range(9):
        val = int(cedula[i]) * coefficients[i]
        if val >= 10:
            val -= 9
        total += val

    check_digit = int(cedula[9])

    # Obtener el residuo y el dígito esperado
    remainder = total % 10
    if remainder == 0:
        expected_digit = 0
    else:
        expected_digit = 10 - remainder

    return expected_digit == check_digit
