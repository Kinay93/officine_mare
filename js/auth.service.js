import supabase from "./supabase-client.js";

export async function login(email, password){
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if(error) throw error;
  return data;
}

export async function logout(){
  const { error } = await supabase.auth.signOut();
  if(error) throw error;
}

export async function getSession(){
  const { data, error } = await supabase.auth.getSession();
  if(error) throw error;
  return data.session;
}

export async function requireAuth(){
  const session = await getSession();
  if(!session){
    window.location.href = "login.html";
    throw new Error("Utente non autenticato");
  }
  return session;
}
