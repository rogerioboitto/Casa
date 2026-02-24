import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  Unsubscribe,
  setDoc,
  getDoc
} from 'firebase/firestore';
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "firebase/storage";
import { dbInstance, storageInstance } from './firebaseConfig';
import { Tenant, Property, EnergyBill, WaterBill, TenantDocument } from '../types';

const COLLECTION_TENANTS = 'tenants';
const COLLECTION_PROPERTIES = 'properties';
const COLLECTION_BILLS = 'energy_bills';
const COLLECTION_BILL_CONTENTS = 'energy_bill_contents'; // Nova coleção para Base64
const COLLECTION_WATER_BILLS = 'water_bills';
const COLLECTION_WATER_BILL_CONTENTS = 'water_bill_contents'; // Nova coleção para Base64
const COLLECTION_ALLOWED_EMAILS = 'allowed_emails';

export const db = {
  // --- TENANTS ---
  getTenants: async (): Promise<Tenant[]> => {
    const querySnapshot = await getDocs(collection(dbInstance, COLLECTION_TENANTS));
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Tenant));
  },

  subscribeToTenants: (callback: (tenants: Tenant[]) => void): Unsubscribe => {
    const q = query(collection(dbInstance, COLLECTION_TENANTS));
    return onSnapshot(q, (snapshot) => {
      const tenants = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Tenant));
      callback(tenants);
    });
  },

  addTenant: async (tenant: Omit<Tenant, 'id'>): Promise<Tenant> => {
    const docRef = await addDoc(collection(dbInstance, COLLECTION_TENANTS), tenant);
    return { id: docRef.id, ...tenant };
  },

  updateTenant: async (id: string, updates: Partial<Tenant>): Promise<void> => {
    const tenantRef = doc(dbInstance, COLLECTION_TENANTS, id);
    await updateDoc(tenantRef, updates);
  },

  deleteTenant: async (id: string): Promise<void> => {
    await deleteDoc(doc(dbInstance, COLLECTION_TENANTS, id));
  },

  // --- TENANT DOCUMENTS ---
  uploadTenantDocument: async (tenantId: string, file: File, type: string, onProgress: (progress: number) => void): Promise<TenantDocument> => {
    const fileId = crypto.randomUUID();
    const extension = file.name.split('.').pop();
    const fileName = `${fileId}.${extension}`;
    const storageRef = ref(storageInstance, `tenants/${tenantId}/${fileName}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    return new Promise((resolve, reject) => {
      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          onProgress(progress);
        },
        (error) => {
          reject(error);
        },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          const newDoc: TenantDocument = {
            id: fileId,
            name: file.name,
            type: type,
            url: downloadURL,
            uploadedAt: new Date().toISOString()
          };
          resolve(newDoc);
        }
      );
    });
  },

  deleteTenantDocument: async (url: string): Promise<void> => {
    // Extrai o path da URL do Firebase Storage
    // Ex: .../o/tenants%2FtenantId%2FfileId.ext?alt=...
    try {
      const storageRef = ref(storageInstance, url);
      await deleteObject(storageRef);
    } catch (error: any) {
      if (error.code === 'storage/object-not-found') {
        return; // Já deletado
      }
      throw error;
    }
  },

  // --- PROPERTIES ---
  getProperties: async (): Promise<Property[]> => {
    const querySnapshot = await getDocs(collection(dbInstance, COLLECTION_PROPERTIES));
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Property));
  },

  subscribeToProperties: (callback: (properties: Property[]) => void): Unsubscribe => {
    const q = query(collection(dbInstance, COLLECTION_PROPERTIES));
    return onSnapshot(q, (snapshot) => {
      const properties = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Property));
      callback(properties);
    });
  },

  addProperty: async (property: Omit<Property, 'id'>): Promise<Property> => {
    const docRef = await addDoc(collection(dbInstance, COLLECTION_PROPERTIES), property);
    return { id: docRef.id, ...property };
  },

  updateProperty: async (id: string, updates: Partial<Property>): Promise<void> => {
    const propertyRef = doc(dbInstance, COLLECTION_PROPERTIES, id);
    await updateDoc(propertyRef, updates);
  },

  deleteProperty: async (id: string): Promise<void> => {
    await deleteDoc(doc(dbInstance, COLLECTION_PROPERTIES, id));
  },

  // --- ENERGY BILLS ---
  getEnergyBills: async (): Promise<EnergyBill[]> => {
    const querySnapshot = await getDocs(collection(dbInstance, COLLECTION_BILLS));
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as EnergyBill));
  },

  subscribeToEnergyBills: (callback: (bills: EnergyBill[]) => void): Unsubscribe => {
    const q = query(collection(dbInstance, COLLECTION_BILLS));
    return onSnapshot(q, (snapshot) => {
      const bills = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as EnergyBill));
      callback(bills);
    });
  },

  addEnergyBill: async (bill: Omit<EnergyBill, 'id'>): Promise<EnergyBill> => {
    const { fileUrl, ...metadata } = bill;
    let hasContent = false;

    if (fileUrl && fileUrl.length > 1000) {
      hasContent = true;
    }

    const docRef = await addDoc(collection(dbInstance, COLLECTION_BILLS), {
      ...metadata,
      hasContent,
      fileUrl: hasContent ? null : fileUrl
    });

    if (hasContent && fileUrl) {
      await setDoc(doc(dbInstance, COLLECTION_BILL_CONTENTS, docRef.id), {
        fileUrl: fileUrl
      });
    }

    return { id: docRef.id, ...bill, hasContent };
  },

  getEnergyBillContent: async (id: string): Promise<string | null> => {
    try {
      const docRef = doc(dbInstance, COLLECTION_BILL_CONTENTS, id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data().fileUrl;
      }
      return null;
    } catch (e) {
      console.error(`Erro ao buscar conteúdo da fatura Energia (${id}):`, e);
      return null;
    }
  },

  deleteEnergyBill: async (id: string): Promise<void> => {
    await deleteDoc(doc(dbInstance, COLLECTION_BILLS, id));
    try {
      await deleteDoc(doc(dbInstance, COLLECTION_BILL_CONTENTS, id));
    } catch (e) {
    }
  },

  updateEnergyBill: async (id: string, updates: Partial<EnergyBill>): Promise<void> => {
    const billRef = doc(dbInstance, COLLECTION_BILLS, id);
    await updateDoc(billRef, updates);
  },

  // --- WATER BILLS ---
  getWaterBills: async (): Promise<WaterBill[]> => {
    const querySnapshot = await getDocs(collection(dbInstance, COLLECTION_WATER_BILLS));
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as WaterBill));
  },

  subscribeToWaterBills: (callback: (bills: WaterBill[]) => void): Unsubscribe => {
    const q = query(collection(dbInstance, COLLECTION_WATER_BILLS));
    return onSnapshot(q, (snapshot) => {
      const bills = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as WaterBill));
      callback(bills);
    });
  },

  addWaterBill: async (bill: Omit<WaterBill, 'id'>): Promise<WaterBill> => {
    const { fileUrl, ...metadata } = bill;
    let hasContent = false;

    if (fileUrl && fileUrl.length > 1000) {
      hasContent = true;
    }

    const docRef = await addDoc(collection(dbInstance, COLLECTION_WATER_BILLS), {
      ...metadata,
      hasContent,
      fileUrl: hasContent ? null : fileUrl
    });

    if (hasContent && fileUrl) {
      await setDoc(doc(dbInstance, COLLECTION_WATER_BILL_CONTENTS, docRef.id), {
        fileUrl: fileUrl
      });
    }

    return { id: docRef.id, ...bill, hasContent };
  },

  getWaterBillContent: async (id: string): Promise<string | null> => {
    try {
      const docRef = doc(dbInstance, COLLECTION_WATER_BILL_CONTENTS, id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        return docSnap.data().fileUrl;
      }
      return null;
    } catch (e) {
      console.error(`Erro ao buscar conteúdo da fatura Água (${id}):`, e);
      return null;
    }
  },

  updateWaterBill: async (id: string, updates: Partial<WaterBill>): Promise<void> => {
    const billRef = doc(dbInstance, COLLECTION_WATER_BILLS, id);
    await updateDoc(billRef, updates);
  },

  deleteWaterBill: async (id: string): Promise<void> => {
    await deleteDoc(doc(dbInstance, COLLECTION_WATER_BILLS, id));
    try {
      await deleteDoc(doc(dbInstance, COLLECTION_WATER_BILL_CONTENTS, id));
    } catch (e) {
    }
  },

  // --- MIGRATION (One-time use) ---
  migrateBillsToSplitSchema: async () => {
    console.log("Iniciando migração de faturas...");
    const energyBills = await getDocs(collection(dbInstance, COLLECTION_BILLS));
    let energyCount = 0;
    for (const docSnapshot of energyBills.docs) {
      const data = docSnapshot.data();
      if (data.fileUrl && data.fileUrl.length > 1000 && !data.hasContent) {
        await setDoc(doc(dbInstance, COLLECTION_BILL_CONTENTS, docSnapshot.id), {
          fileUrl: data.fileUrl
        });
        await updateDoc(docSnapshot.ref, {
          fileUrl: null,
          hasContent: true
        });
        energyCount++;
      }
    }
    console.log(`Migração Energia: ${energyCount} faturas processadas.`);

    const waterBills = await getDocs(collection(dbInstance, COLLECTION_WATER_BILLS));
    let waterCount = 0;
    for (const docSnapshot of waterBills.docs) {
      const data = docSnapshot.data();
      if (data.fileUrl && data.fileUrl.length > 1000 && !data.hasContent) {
        await setDoc(doc(dbInstance, COLLECTION_WATER_BILL_CONTENTS, docSnapshot.id), {
          fileUrl: data.fileUrl
        });
        await updateDoc(docSnapshot.ref, {
          fileUrl: null,
          hasContent: true
        });
        waterCount++;
      }
    }
    console.log(`Migração Água: ${waterCount} faturas processadas.`);
  },

  // --- ACCESS CONTROL ---
  getAllowedEmails: async (): Promise<string[]> => {
    const querySnapshot = await getDocs(collection(dbInstance, COLLECTION_ALLOWED_EMAILS));
    return querySnapshot.docs.map(doc => doc.id);
  },

  subscribeToAllowedEmails: (callback: (emails: string[]) => void): Unsubscribe => {
    const q = query(collection(dbInstance, COLLECTION_ALLOWED_EMAILS));
    return onSnapshot(q, (snapshot) => {
      const emails = snapshot.docs.map(doc => doc.id);
      callback(emails);
    });
  },

  addAllowedEmail: async (email: string): Promise<void> => {
    const emailRef = doc(dbInstance, COLLECTION_ALLOWED_EMAILS, email.toLowerCase().trim());
    await setDoc(emailRef, { addedAt: new Date().toISOString() });
  },

  deleteAllowedEmail: async (email: string): Promise<void> => {
    await deleteDoc(doc(dbInstance, COLLECTION_ALLOWED_EMAILS, email.toLowerCase().trim()));
  },

  isEmailAllowed: async (email: string): Promise<boolean> => {
    const emailRef = doc(dbInstance, COLLECTION_ALLOWED_EMAILS, email.toLowerCase().trim());
    const docSnap = await getDoc(emailRef);
    return docSnap.exists();
  }
};