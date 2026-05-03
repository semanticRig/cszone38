using System;
using System.Threading.Tasks;

public class CleanService
{
    public async Task<int> AddAsync(int left, int right)
    {
        if (left < 0 || right < 0)
        {
            throw new ArgumentOutOfRangeException();
        }

        return await Task.FromResult(left + right);
    }
}