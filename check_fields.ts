
import { db } from './services/db';

async function checkData() {
  try {
    const bills = await db.getEnergyBills();
    const replacementBills = bills.filter(b => b.isReplacement && b.referenceMonth === '2026-03');
    console.log("=== ENERGY REPLACEMENT BILLS ===");
    replacementBills.forEach(b => {
      console.log(`ID: ${b.id}`);
      console.log(`fileUrl: ${!!b.fileUrl}`);
      console.log(`newMeterStartPhotoUrl: ${!!b.newMeterStartPhotoUrl}`);
      console.log(`newMeterEndPhotoUrl: ${!!b.newMeterEndPhotoUrl}`);
      console.log(`Names: ${Object.keys(b).join(', ')}`);
    });
  } catch (e) {
    console.error(e);
  }
}

// Para rodar isso no ambiente do usuário, eu precisaria de um contexto de execução.
// Como não posso rodar scripts TS diretamente sem build, vou sugerir que eu mesmo cheque via browser.
