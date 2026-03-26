
import { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { authInstance } from '../services/firebaseConfig';
import { db } from '../services/db';
import { Tenant, Property, EnergyBill, WaterBill } from '../types';
import { APP_CONFIG } from '../constants';

export const useAppState = () => {
    // Data State
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [properties, setProperties] = useState<Property[]>([]);
    const [bills, setBills] = useState<EnergyBill[]>([]);
    const [waterBills, setWaterBills] = useState<WaterBill[]>([]);

    // Auth & Authorization
    const [user, setUser] = useState<User | null>(null);
    const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    // Contextual State
    const [activeTab, setActiveTab] = useState('properties');
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error' | 'info') => {
        setToast({ message, type });
    };

    useEffect(() => {
        // Subscriptions
        const unsubTenants = db.subscribeToTenants(setTenants);
        const unsubProperties = db.subscribeToProperties(setProperties);
        const unsubBills = db.subscribeToEnergyBills(setBills);
        const unsubWaterBills = db.subscribeToWaterBills(setWaterBills);

        return () => {
            unsubTenants();
            unsubProperties();
            unsubBills();
            unsubWaterBills();
        };
    }, []);

    useEffect(() => {
        const unsubAuth = onAuthStateChanged(authInstance, async (firebaseUser) => {
            setUser(firebaseUser);

            if (firebaseUser) {
                const allowed = await db.isEmailAllowed(firebaseUser.email || '');

                if (!allowed) {
                    // Fail-safe for first admin
                    const emails = await db.getAllowedEmails();
                    if (emails.length === 0 && firebaseUser.email === APP_CONFIG.DEFAULT_ADMIN) {
                        await db.addAllowedEmail(APP_CONFIG.DEFAULT_ADMIN);
                        setIsAuthorized(true);
                    } else {
                        setIsAuthorized(allowed);
                    }
                } else {
                    setIsAuthorized(true);
                }
            } else {
                setIsAuthorized(false);
            }
            setAuthLoading(false);
        });

        return () => unsubAuth();
    }, []);

    return {
        tenants, setTenants,
        properties, setProperties,
        bills, setBills,
        waterBills, setWaterBills,
        user,
        isAuthorized,
        authLoading,
        activeTab, setActiveTab,
        toast, setToast,
        showToast
    };
};
