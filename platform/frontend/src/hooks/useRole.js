import { useAuth } from '../store/auth.js';

export function useRole() {
  const { user } = useAuth();
  const role = user?.role || 'buyer';
  return {
    role,
    isOwner: role === 'owner',
    isBuyer: role === 'buyer',
    isAnalyst: role === 'analyst',
    isLead: role === 'lead',
    canManageTeam: role === 'owner' || role === 'lead',
    canSeeAllCampaigns: role !== 'buyer',
    canInvite: role === 'owner',
  };
}
