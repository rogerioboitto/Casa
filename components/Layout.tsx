import React, { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  Home,
  Zap,
  Shield,
  Menu,
  X,
  LogOut,
  ChevronRight,
  CreditCard,
  Download
} from 'lucide-react';
import { authInstance } from '../services/firebaseConfig';
import { signOut } from 'firebase/auth';
import { InstallPrompt } from './InstallPrompt';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab }) => {
  const [isInstallPromptOpen, setIsInstallPromptOpen] = useState(false);



  const menuItems = [
    { id: 'properties', label: 'Unidades', icon: <Home size={20} /> },
    { id: 'tenants', label: 'Inquilinos', icon: <Users size={20} /> },
    { id: 'energy', label: 'Contas', icon: <Zap size={20} /> },
    { id: 'asaas', label: 'Asaas', icon: <CreditCard size={20} /> },
    { id: 'security', label: 'Segurança', icon: <Shield size={20} /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex flex-col w-72 bg-slate-900 text-white fixed h-full shadow-2xl z-50">
        <div className="p-8 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Home className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">BOITTO</h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Admin Dashboard</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-6 space-y-2 mt-4">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center justify-between p-4 rounded-2xl transition-all duration-300 group ${activeTab === item.id
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 translate-x-1'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
            >
              <div className="flex items-center space-x-4">
                <div className={`${activeTab === item.id ? 'text-white' : 'text-slate-500 group-hover:text-white'} transition-colors`}>
                  {item.icon}
                </div>
                <span className="font-semibold text-sm">{item.label}</span>
              </div>
              <ChevronRight size={16} className={`${activeTab === item.id ? 'opacity-100' : 'opacity-0'} transition-opacity`} />
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-slate-800">
          <button
            onClick={() => signOut(authInstance)}
            className="w-full flex items-center space-x-4 p-4 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-2xl transition-all duration-300 group"
          >
            <LogOut size={20} className="group-hover:translate-x-1 transition-transform" />
            <span className="font-semibold text-sm">Sair</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-72 min-h-screen">
        {/* Header - Mobile */}
        <header className="lg:hidden bg-slate-900 text-white p-4 sticky top-0 z-[60] flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Home size={18} />
            </div>
            <span className="font-bold">BOITTO</span>
          </div>
          <button
            onClick={() => setIsInstallPromptOpen(true)}
            className="p-2 bg-slate-800 text-slate-400 hover:text-white rounded-lg transition-colors"
            title="Instalar App"
          >
            <Download size={18} />
          </button>
        </header>
        <div className="p-4 lg:p-12 pb-24 lg:pb-12 max-w-7xl mx-auto animate-fade-in">
          {children}
        </div>

        <InstallPrompt isOpen={isInstallPromptOpen} onClose={() => setIsInstallPromptOpen(false)} />

        {/* Floating Nav - Mobile */}
        <nav className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-full px-4 py-2 flex items-center gap-1 shadow-2xl z-[60]">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`p-3 rounded-full transition-all flex items-center justify-center ${activeTab === item.id
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                : 'text-slate-400 hover:text-white'
                }`}
            >
              {item.icon}
            </button>
          ))}
          <div className="w-[1px] h-6 bg-slate-800 mx-2" />
          <button
            onClick={() => signOut(authInstance)}
            className="p-3 bg-red-500/10 text-red-400 rounded-full hover:bg-red-500/20 transition-all"
          >
            <LogOut size={20} />
          </button>
        </nav>
      </main>
    </div>
  );
};

export default Layout;