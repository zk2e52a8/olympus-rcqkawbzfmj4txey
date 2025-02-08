const puppeteer = require('/tmp/npm/node_modules/puppeteer-extra');
const StealthPlugin = require('/tmp/npm/node_modules/puppeteer-extra-plugin-stealth');
const fs = require('fs');

const MINIMO_PAGINAS = 2;

// TODO Añadir una verificación para el cambio de dominio, que permita actualizarlo en el JSON

puppeteer.use(StealthPlugin());

// Función para leer el archivo JSON de datos
function leerDatos() {
	try {
		const datos = fs.readFileSync(`./datos.json`, 'utf8');
		return JSON.parse(datos);
	} catch (error) {
		console.error('Error al leer datos.json:', error);
		process.exit(1);
	}
}

// Función para leer el timestamp
function leerTimestamp() {
	try {
		return fs.readFileSync(`./timestamp.txt`, 'utf8').trim();
	} catch {
		return "2025-01-01T00:00:00.000000Z"; // Fecha por defecto si no se encuentra la fecha o archivo
	}
}

// Función para guardar el timestamp con la hora actual
function guardarTimestamp() {
	const timestampActual = new Date().toISOString().replace('Z', '000Z');
	fs.writeFileSync(`./timestamp.txt`, timestampActual);
	console.log('Timestamp actualizado con la hora actual:', timestampActual);
}

// Función para guardar los datos actualizados en el archivo JSON
function guardarDatos(datos) {
	fs.writeFileSync(`./datos.json`, JSON.stringify(datos, null, 2));
	console.log('Datos actualizados en datos.json');
}

// Función para validar el formato de fecha
function esFormatoFechaValido(fecha) {
	// Verifica que la fecha siga el formato esperado (ISO 8601)
	const formatoFecha = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
	if (!formatoFecha.test(fecha)) {
		console.error(`Formato de fecha inválido: ${fecha}`);
		return false;
	}

	// Verifica que la fecha sea válida (no solo el formato)
	const fechaObj = new Date(fecha);
	if (isNaN(fechaObj.getTime())) {
		console.error(`Fecha inválida: ${fecha}`);
		return false;
	}

	return true;
}

async function main() {
	let browser;
	try {
		const datos = leerDatos();
		const timestampGuardado = leerTimestamp();

		// Crear un índice de fichas basado en sus nombres
		const fichasMap = new Map(datos.fichas.map(ficha => [ficha.nombre, ficha]));

		// Lanzar un navegador de puppeteer sin gui ni sandbox (conflictiva con espacios virtuales)
		browser = await puppeteer.launch({
			headless: true,
			args: ['--no-sandbox'],
			defaultViewport: null
		});

		// Crear una nueva página en el navegador
		const page = await browser.newPage();

		// Bloquear recursos multimedia
		await page.setRequestInterception(true);
		page.on('request', (request) => {
			if (['image', 'media', 'font'].includes(request.resourceType())) {
				request.abort();
			} else {
				request.continue();
			}
		});

		let numeroPagina = 1;

		while (true) {
			console.log(`\nRevisando página ${numeroPagina}...`);

			// Construir URL de la página actual
			const urlPagina = `${datos.dominio}/capitulos?page=${numeroPagina}`;
			await page.goto(urlPagina, { waitUntil: 'networkidle0' }); // Esperar a que se cargue completamente
			await page.waitForSelector('.bg-gray-800.p-4.rounded-xl.relative'); // Esperar que el selector esté disponible

			// Obtener todas las fichas de la página actual
			const fichas = await page.evaluate((dominio) => {
				const fichasEncontradas = [];
				document.querySelectorAll('.bg-gray-800.p-4.rounded-xl.relative').forEach(ficha => {
					// Extraer los datos relevantes de cada ficha
					fichasEncontradas.push({
						nombre: ficha.querySelector('figcaption').innerText.trim(),
						url: dominio + ficha.querySelector('a[title]').getAttribute('href'),
						capitulo: ficha.querySelector('.flex.flex-col.gap-2.mt-4 a:first-child #name').innerText.trim(),
						fecha: ficha.querySelector('.flex.flex-col.gap-2.mt-4 a:first-child time').getAttribute('datetime')
					});
				});
				return fichasEncontradas;
			}, datos.dominio);

			// Si no se encuentran más fichas en la página actual, terminar la búsqueda
			if (fichas.length === 0) {
				console.log('No se encontraron más fichas');
				break;
			}

			// Actualizar todas las fichas de la página actual
			for (const fichaWeb of fichas) {
				if (fichasMap.has(fichaWeb.nombre)) {
					const fichaExistente = fichasMap.get(fichaWeb.nombre);

					// Extraer el número de capítulo ("0" si no se encuentra o no se puede leer)
					const numCapExistente = parseInt(fichaExistente.capitulo.match(/\d+/)?.[0] || '0');
					const numCapWeb = parseInt(fichaWeb.capitulo.match(/\d+/)?.[0] || '0');

					// Actualizar solo si el capítulo web es igual o mayor al existente
					if (numCapWeb >= numCapExistente) {
						console.log(`Actualizando ficha: ${fichaWeb.nombre}`);
						fichaExistente.capitulo = fichaWeb.capitulo;
						fichaExistente.url = fichaWeb.url;
					} else {
						console.log(`Omitiendo actualización de ${fichaWeb.nombre}: capítulo web (${numCapWeb}) es menor que el existente (${numCapExistente})`);
					}
				}
			}

			// Verificar si debemos continuar con la siguiente página
			const ultimaFicha = fichas[fichas.length - 1];
			if ((!esFormatoFechaValido(ultimaFicha.fecha) || ultimaFicha.fecha <= timestampGuardado)
				&& numeroPagina >= MINIMO_PAGINAS) {
				console.log('Alcanzado el límite de tiempo o fecha inválida, y mínimo de páginas revisadas, terminando...');
			break;
				}

			numeroPagina++;
			await new Promise(resolve => setTimeout(resolve, 5000)); // Espera entre descargas, en milisegundos
		}

		// Guardar el nuevo timestamp con la hora actual
		guardarTimestamp();

		// Escribir en el disco los datos actualizados del archivo JSON
		guardarDatos(datos);

	} catch (error) {
		console.error('Error durante el scraping:', error);
		throw error; // Propaga el error hacia arriba
	} finally {
		if (browser) {
			await browser.close(); // Asegura que el navegador se cierre
		}
	}
}

// Maneja el error a nivel superior
main().catch(error => {
	console.error('Error fatal en la aplicación:', error);
	process.exit(1); // Ahora es seguro salir
});




// Copia del workflow de gitub
// .github/workflows/ejecutar_script.yml

// name: Ejecutar script
//
// on:
//   schedule:
//     - cron: '0 */4 * * *'
//   workflow_dispatch:
//
// jobs:
//   ejecutar_script:
//     runs-on: ubuntu-latest
//
//     steps:
//       - name: Clonar repositorio
//         uses: actions/checkout@v4
//
//       - name: Configurar Node.js
//         uses: actions/setup-node@v4
//
//       - name: Instalar dependencias
//         run: |
//           npm install --prefix "/tmp/npm" puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
//
//       - name: Configurar git
//         run: |
//           git config --global user.name "github-actions"
//           git config --global user.email "actions@github.com"
//
//       - name: Ejecutar script
//         run: |
//           node ./olympus_scraping.js
//
//       - name: Subir cambios
//         run: |
//           git add -A
//           git commit -m "Actualizado" || echo "Sin cambios"
//           git pull origin main --rebase
//           git push origin main


// datos.json

// {
// 	"notas": [
// 		"Solo es necesario pegar el nombre de cada ficha, pero este debe ser exacto.",
// 		"Cuidado con la sintaxis: las comas son necesarias después de cada línea EXCEPTO la última de cada sección.",
// 		"Ejemplo: 'nombre' y 'capitulo' necesitan coma, pero 'url' no. La última ficha no necesita coma después del }"
// 	],
// 	"dominio": "",
// 	"fichas": [
// 		{
// 			"nombre": "",
// 			"capitulo": "",
// 			"url": ""
// 		},
// 		{
// 			"nombre": "",
// 			"capitulo": "",
// 			"url": ""
// 		}
// 	]
// }
