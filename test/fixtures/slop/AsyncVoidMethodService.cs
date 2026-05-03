using System.Threading.Tasks;

public class AsyncVoidMethodService
{
    public async void RunAsync()
    {
        await Task.Delay(1);
    }
}