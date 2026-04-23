import { useState, useEffect, useCallback } from 'react';
import { 
  Upload, 
  File, 
  Trash2, 
  Share2, 
  ExternalLink, 
  Lock, 
  Globe, 
  Search,
  Check,
  Copy,
  ChevronDown,
  Cloud,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  MoreVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDropzone } from 'react-dropzone';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Firebase imports
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc,
  serverTimestamp,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL, 
  deleteObject 
} from 'firebase/storage';
import { auth, db, storage, handleFirestoreError, isFirebaseConfigValid } from './lib/firebase';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
  ownerId: string;
  storagePath: string;
  downloadUrl: string;
  createdAt: any;
  isPublic: boolean;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<{ [key: string]: number }>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigValid || !auth || !db) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Create user profile if not exists
        const userRef = doc(db, 'users', u.uid);
        getDoc(userRef).then(docSnap => {
          if (!docSnap.exists()) {
            setDoc(userRef, {
              email: u.email,
              displayName: u.displayName,
              storageUsed: 0,
              createdAt: serverTimestamp()
            });
          }
        });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setFiles([]);
      return;
    }

    const q = query(
      collection(db, 'files'),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newFiles = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FileMetadata[];
      setFiles(newFiles);
    }, (error) => {
      console.error("Error fetching files:", error);
    });

    return unsubscribe;
  }, [user]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!user || !storage || !db) return;

    for (const file of acceptedFiles) {
      const fileId = Math.random().toString(36).substring(7);
      const storagePath = `files/${user.uid}/${fileId}-${file.name}`;
      const storageRef = ref(storage, storagePath);
      
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadingFiles(prev => ({ ...prev, [fileId]: progress }));
        }, 
        (error) => {
          console.error("Upload error:", error);
          setUploadingFiles(prev => {
            const next = { ...prev };
            delete next[fileId];
            return next;
          });
        }, 
        async () => {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          
          try {
            await addDoc(collection(db, 'files'), {
              name: file.name,
              size: file.size,
              type: file.type,
              ownerId: user.uid,
              storagePath,
              downloadUrl,
              createdAt: serverTimestamp(),
              isPublic: false
            });
          } catch (e) {
            handleFirestoreError(e, 'create', 'files');
          }

          setUploadingFiles(prev => {
            const next = { ...prev };
            delete next[fileId];
            return next;
          });
        }
      );
    }
  }, [user]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    multiple: true
  } as any);

  const handleLogin = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => auth && signOut(auth);

  const handleDelete = async (file: FileMetadata) => {
    if (!confirm('Are you sure you want to delete this file?') || !storage || !db) return;
    
    try {
      await deleteObject(ref(storage, file.storagePath));
      await deleteDoc(doc(db, 'files', file.id));
    } catch (e) {
      handleFirestoreError(e, 'delete', `files/${file.id}`);
    }
  };

  const togglePublic = async (file: FileMetadata) => {
    if (!db) return;
    try {
      await updateDoc(doc(db, 'files', file.id), {
        isPublic: !file.isPublic
      });
    } catch (e) {
      handleFirestoreError(e, 'update', `files/${file.id}`);
    }
  };

  const copyLink = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-5 h-5 text-blue-500" />;
    if (type.startsWith('video/')) return <Video className="w-5 h-5 text-purple-500" />;
    if (type.startsWith('audio/')) return <Music className="w-5 h-5 text-pink-500" />;
    if (type.includes('pdf') || type.includes('text')) return <FileText className="w-5 h-5 text-green-500" />;
    return <File className="w-5 h-5 text-gray-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white font-sans relative flex items-center justify-center p-4 sm:p-8">
      {/* Background Mesh Gradients */}
      <div className="mesh-gradient">
        <div className="mesh-1"></div>
        <div className="mesh-2"></div>
        <div className="mesh-3"></div>
      </div>

      {/* Main Glass Container */}
      <div className="relative w-full max-w-7xl h-full min-h-[85vh] bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[40px] shadow-2xl flex flex-col overflow-hidden">
        
        {!isFirebaseConfigValid && (
          <div className="absolute top-0 left-0 w-full z-50 bg-red-500/20 backdrop-blur-md border-b border-red-500/30 px-4 py-2 flex items-center justify-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-red-200">Firebase Setup Required</span>
            <span className="text-[10px] text-red-100/60">Uploads and sorting will be available once configured in the UI.</span>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex items-center justify-between px-6 sm:px-10 pt-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Cloud className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">CLOUD<span className="text-blue-400">DROP</span></span>
          </div>

          <div className="flex items-center gap-4 sm:gap-8 transition-all">
            {user && (
              <div className="hidden md:flex items-center gap-6 mr-4 border-r border-white/10 pr-8 h-8">
                <button className="text-sm font-medium text-white/60 hover:text-white transition-colors">My Files</button>
                <button className="text-sm font-medium text-white/60 hover:text-white transition-colors">Transfers</button>
              </div>
            )}
            
            <div className="flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex flex-col items-end">
                    <p className="text-xs text-white/40">Premium Member</p>
                    <p className="text-sm font-semibold">{user.displayName}</p>
                  </div>
                  <div className="group relative">
                    <img 
                      src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                      alt="Profile" 
                      className="w-10 h-10 rounded-full bg-white/10 border border-white/20 p-0.5 cursor-pointer ring-0 group-hover:ring-2 ring-white/30 transition-all"
                    />
                    <div className="absolute top-full right-0 mt-3 hidden group-hover:block w-40">
                      <div className="bg-gray-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 shadow-2xl">
                        <button 
                          onClick={handleLogout}
                          className="w-full text-left px-4 py-2 text-xs font-semibold text-red-400 hover:bg-white/5 rounded-xl transition-colors"
                        >
                          Sign Out
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={handleLogin}
                  className="px-6 py-2.5 bg-white text-black rounded-full font-bold text-sm hover:bg-blue-400 hover:text-white transition-all shadow-lg shadow-white/5 active:scale-95"
                >
                  Join CloudDrop
                </button>
              )}
            </div>
          </div>
        </nav>

        <main className="flex-1 p-6 sm:p-10">
          {!user ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-8 max-w-3xl mx-auto">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-white mb-6">
                  Next-gen files,<br />shared <span className="text-blue-400 italic">instantly.</span>
                </h1>
                <p className="text-lg text-white/40 leading-relaxed max-w-xl mx-auto">
                  Encrypted, fast, and remarkably simple. Experience the future of cloud storage with our frosted glass interface.
                </p>
                <button 
                  onClick={handleLogin}
                  className="bg-white text-black px-10 py-4 rounded-full text-lg font-bold hover:bg-blue-400 hover:text-white transition-all shadow-xl shadow-white/5 hover:shadow-blue-500/20 active:scale-95 flex items-center gap-3 mx-auto"
                >
                  <Upload className="w-5 h-5" />
                  Get Started
                </button>
              </motion.div>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 w-full">
                {[
                  { icon: <Globe className="text-blue-400" />, title: "Global CDN", desc: "Edge sharing speed." },
                  { icon: <Lock className="text-purple-400" />, title: "E2E Secure", desc: "Privacy guaranteed." },
                  { icon: <Cloud className="text-indigo-400" />, title: "10GB Free", desc: "Join our network." }
                ].map((feature, i) => (
                  <div key={i} className="bg-white/5 p-6 rounded-3xl border border-white/5 backdrop-blur-lg">
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center mb-4 text-blue-400">
                      {feature.icon}
                    </div>
                    <h3 className="font-bold text-base mb-1">{feature.title}</h3>
                    <p className="text-xs text-white/30">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-full grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Left Column: Upload & Stats */}
              <div className="lg:col-span-4 flex flex-col gap-6">
                {/* Dropzone */}
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "flex-1 border-2 border-dashed rounded-[32px] p-8 text-center transition-all duration-300 relative overflow-hidden flex flex-col items-center justify-center gap-6 group cursor-pointer",
                    isDragActive ? "border-blue-500 bg-white/10" : "border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className={cn(
                    "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300",
                    isDragActive ? "bg-blue-500 text-white scale-110 shadow-lg shadow-blue-500/30" : "bg-blue-500/10 text-blue-400 group-hover:scale-105"
                  )}>
                    <Upload className="w-10 h-10" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold mb-2">Drop it here</h2>
                    <p className="text-white/40 text-sm">Max size 10GB for premium users</p>
                  </div>
                  <button className="px-8 py-3 bg-white text-black rounded-full font-bold text-sm hover:bg-blue-400 hover:text-white transition-colors shadow-lg shadow-white/5">
                    Select Files
                  </button>

                  <AnimatePresence>
                    {Object.keys(uploadingFiles).length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-[#05070a]/80 backdrop-blur-xl rounded-[32px] flex items-center justify-center p-6 z-20"
                      >
                        <div className="w-full space-y-6">
                          <h3 className="text-lg font-semibold italic text-blue-400">Processing...</h3>
                          {Object.entries(uploadingFiles).map(([id, progress]) => (
                            <div key={id} className="space-y-2">
                              <div className="flex justify-between text-xs font-mono">
                                <span className="text-white/40">UPLOADING</span>
                                <span>{Math.round(progress as number)}%</span>
                              </div>
                              <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${progress}%` }}
                                  className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Storage Stats */}
                <div className="p-8 bg-gradient-to-br from-white/10 to-transparent rounded-[32px] border border-white/10 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <h3 className="text-lg font-semibold">Cloud Storage</h3>
                      <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-widest">Active</span>
                    </div>
                    <p className="text-sm text-white/40 mb-6">Using 64% of optimized capacity.</p>
                    <div className="flex items-end gap-2 mb-6">
                      <span className="text-4xl font-bold">{formatFileSize(files.reduce((acc, f) => acc + f.size, 0)).split(' ')[0]}</span>
                      <span className="text-white/40 mb-1.5 font-medium">{formatFileSize(files.reduce((acc, f) => acc + f.size, 0)).split(' ')[1]} / 10 GB</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden mb-8">
                       <div className="h-full bg-blue-500 w-[64%]" />
                    </div>
                  </div>
                  <button className="w-full py-4 bg-white/5 border border-white/10 rounded-2xl text-xs font-bold hover:bg-white/10 transition-colors uppercase tracking-[0.2em]">
                    Expand Network Capacity
                  </button>
                </div>
              </div>

              {/* Right Column: File Display */}
              <div className="lg:col-span-8 flex flex-col gap-6 overflow-hidden">
                {/* Search & Header */}
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold tracking-tight">Active Nodes</h2>
                    <span className="text-xs bg-white/10 px-2 py-0.5 rounded-md text-white/40 font-mono">{filteredFiles.length}</span>
                  </div>
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input 
                      type="text" 
                      placeholder="Search index..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-sm text-white placeholder:text-white/20 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all outline-none"
                    />
                  </div>
                </div>

                {/* File List */}
                <div className="flex-1 bg-white/5 rounded-[32px] border border-white/10 overflow-hidden flex flex-col">
                  <div className="overflow-auto scrollbar-hide flex-1">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/5">
                          <th className="px-8 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Label</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">Volume</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] hidden sm:table-cell">Created</th>
                          <th className="px-8 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-sm">
                        {filteredFiles.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-8 py-32 text-center">
                              <div className="flex flex-col items-center gap-4">
                                <File className="w-12 h-12 text-white/5" />
                                <p className="text-white/30 font-medium">Network is empty. Initialize upload.</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredFiles.map((file) => (
                            <motion.tr 
                              key={file.id} 
                              layout
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="group hover:bg-white/5 transition-colors"
                            >
                              <td className="px-8 py-5">
                                <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-white/40 group-hover:bg-white/10 transition-colors">
                                    {getFileIcon(file.type)}
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-semibold text-white truncate max-w-[200px] sm:max-w-md">
                                      {file.name}
                                    </span>
                                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                                      {file.isPublic ? (
                                        <span className="text-blue-400 flex items-center gap-1">PUBLIC</span>
                                      ) : (
                                        <span className="text-white/20 flex items-center gap-1">PRIVATE</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-5 font-mono text-xs text-white/40">
                                {formatFileSize(file.size)}
                              </td>
                              <td className="px-8 py-5 text-white/30 hidden sm:table-cell">
                                {file.createdAt ? format(file.createdAt.toDate(), 'dd.MM.yy') : '...'}
                              </td>
                              <td className="px-8 py-5 text-right">
                                <div className="flex justify-end items-center gap-2">
                                  <button 
                                    onClick={() => togglePublic(file)}
                                    className={cn(
                                      "p-2.5 rounded-xl transition-all",
                                      file.isPublic ? "bg-blue-400/10 text-blue-400" : "bg-white/5 text-white/20 hover:text-white/40"
                                    )}
                                  >
                                    {file.isPublic ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                  </button>
                                  <button 
                                    onClick={() => copyLink(file.downloadUrl, file.id)}
                                    className="p-2.5 bg-white/5 text-white/30 hover:text-white/60 hover:bg-white/10 rounded-xl transition-all"
                                  >
                                    {copiedId === file.id ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}
                                  </button>
                                  <button 
                                    onClick={() => handleDelete(file)}
                                    className="p-2.5 bg-white/5 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </motion.tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Footer Info */}
        <footer className="px-10 py-6 flex flex-col sm:flex-row items-center justify-between border-t border-white/10 text-white/30 text-[10px] font-bold uppercase tracking-widest gap-4">
          <div className="flex items-center gap-6">
            <span>&copy; 2026 CLOUDDROP INC.</span>
            <a href="#" className="hover:text-white transition-colors">Nodes</a>
            <a href="#" className="hover:text-white transition-colors">Encryption</a>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
              <span>Protocol: Active</span>
            </div>
            <span className="px-3 py-1 bg-white/5 rounded-full border border-white/10">v2.1.0</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

